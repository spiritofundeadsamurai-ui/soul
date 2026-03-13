#!/usr/bin/env python3
"""
MT5 Bridge — JSON-RPC over stdio for Soul ↔ MetaTrader 5

Soul spawns this as a subprocess. Commands come in via stdin (JSON per line),
responses go out via stdout (JSON per line). Stderr is for debug logging.

Requires: pip install MetaTrader5
Requires: MT5 terminal running on the machine
"""

import sys
import json
import time
import traceback
from datetime import datetime, timezone

try:
    import MetaTrader5 as mt5
except ImportError:
    print(json.dumps({"error": "MetaTrader5 package not installed. Run: pip install MetaTrader5"}), flush=True)
    sys.exit(1)

# ── Timeframe mapping ──
TIMEFRAMES = {
    "M1": mt5.TIMEFRAME_M1,
    "M5": mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30,
    "H1": mt5.TIMEFRAME_H1,
    "H4": mt5.TIMEFRAME_H4,
    "D1": mt5.TIMEFRAME_D1,
    "W1": mt5.TIMEFRAME_W1,
    "MN1": mt5.TIMEFRAME_MN1,
}

initialized = False


def handle_initialize(params):
    global initialized
    path = params.get("path")
    kwargs = {}
    if path:
        kwargs["path"] = path
    ok = mt5.initialize(**kwargs)
    if not ok:
        err = mt5.last_error()
        return {"error": f"MT5 initialize failed: {err}"}
    initialized = True
    info = mt5.terminal_info()
    return {
        "success": True,
        "terminal": {
            "name": info.name if info else "unknown",
            "build": info.build if info else 0,
            "connected": info.connected if info else False,
        },
    }


def handle_login(params):
    account = int(params["account"])
    password = params["password"]
    server = params["server"]
    ok = mt5.login(account, password=password, server=server)
    if not ok:
        err = mt5.last_error()
        return {"error": f"MT5 login failed: {err}"}
    info = mt5.account_info()
    if info:
        return {
            "success": True,
            "account": {
                "login": info.login,
                "name": info.name,
                "server": info.server,
                "balance": info.balance,
                "equity": info.equity,
                "currency": info.currency,
                "leverage": info.leverage,
            },
        }
    return {"success": True}


def handle_get_price(params):
    symbol = params.get("symbol", "XAUUSD")
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        # Try enabling the symbol first
        mt5.symbol_select(symbol, True)
        time.sleep(0.1)
        tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return {"error": f"Cannot get price for {symbol}. Symbol may not exist."}
    return {
        "symbol": symbol,
        "bid": tick.bid,
        "ask": tick.ask,
        "last": tick.last,
        "volume": tick.volume,
        "time": datetime.fromtimestamp(tick.time, tz=timezone.utc).isoformat(),
        "spread": round(tick.ask - tick.bid, 5),
    }


def handle_get_candles(params):
    symbol = params.get("symbol", "XAUUSD")
    tf_str = params.get("timeframe", "H1")
    count = min(int(params.get("count", 100)), 1000)

    tf = TIMEFRAMES.get(tf_str.upper())
    if tf is None:
        return {"error": f"Invalid timeframe: {tf_str}. Use: {', '.join(TIMEFRAMES.keys())}"}

    # Ensure symbol is selected
    mt5.symbol_select(symbol, True)

    rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
    if rates is None or len(rates) == 0:
        err = mt5.last_error()
        return {"error": f"Cannot get candles for {symbol}: {err}"}

    candles = []
    for r in rates:
        candles.append({
            "time": datetime.fromtimestamp(r["time"], tz=timezone.utc).isoformat(),
            "open": float(r["open"]),
            "high": float(r["high"]),
            "low": float(r["low"]),
            "close": float(r["close"]),
            "volume": int(r["tick_volume"]),
        })
    return {"symbol": symbol, "timeframe": tf_str, "count": len(candles), "candles": candles}


def handle_get_account(params):
    info = mt5.account_info()
    if info is None:
        return {"error": "Not logged in or MT5 disconnected"}
    return {
        "login": info.login,
        "name": info.name,
        "server": info.server,
        "balance": info.balance,
        "equity": info.equity,
        "margin": info.margin,
        "free_margin": info.margin_free,
        "profit": info.profit,
        "currency": info.currency,
        "leverage": info.leverage,
    }


def handle_get_positions(params):
    symbol = params.get("symbol")
    if symbol:
        positions = mt5.positions_get(symbol=symbol)
    else:
        positions = mt5.positions_get()

    if positions is None:
        return {"positions": [], "count": 0}

    result = []
    for p in positions:
        result.append({
            "ticket": p.ticket,
            "symbol": p.symbol,
            "type": "buy" if p.type == 0 else "sell",
            "volume": p.volume,
            "open_price": p.price_open,
            "current_price": p.price_current,
            "profit": p.profit,
            "sl": p.sl,
            "tp": p.tp,
            "time": datetime.fromtimestamp(p.time, tz=timezone.utc).isoformat(),
            "comment": p.comment,
        })
    return {"positions": result, "count": len(result)}


def handle_get_symbols(params):
    pattern = params.get("pattern", "*")
    symbols = mt5.symbols_get(pattern)
    if symbols is None:
        return {"symbols": [], "count": 0}
    result = [{"name": s.name, "description": s.description, "bid": s.bid, "ask": s.ask} for s in symbols[:50]]
    return {"symbols": result, "count": len(result)}


def handle_ping(params):
    return {"pong": True, "initialized": initialized, "time": datetime.now(tz=timezone.utc).isoformat()}


def handle_shutdown(params):
    global initialized
    if initialized:
        mt5.shutdown()
        initialized = False
    return {"success": True}


# ── Method dispatch ──
METHODS = {
    "initialize": handle_initialize,
    "login": handle_login,
    "get_price": handle_get_price,
    "get_candles": handle_get_candles,
    "get_account": handle_get_account,
    "get_positions": handle_get_positions,
    "get_symbols": handle_get_symbols,
    "ping": handle_ping,
    "shutdown": handle_shutdown,
}


def main():
    # Signal ready
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({"error": "Invalid JSON"}), flush=True)
            continue

        req_id = request.get("id", "?")
        method = request.get("method", "")
        params = request.get("params", {})

        handler = METHODS.get(method)
        if not handler:
            print(json.dumps({"id": req_id, "error": f"Unknown method: {method}"}), flush=True)
            continue

        try:
            result = handler(params)
            if "error" in result:
                print(json.dumps({"id": req_id, "error": result["error"]}), flush=True)
            else:
                print(json.dumps({"id": req_id, "result": result}), flush=True)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            print(json.dumps({"id": req_id, "error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
