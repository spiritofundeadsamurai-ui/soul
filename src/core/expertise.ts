/**
 * Soul Expertise — Specialized knowledge domains
 *
 * Makes Soul think like an expert in specific fields:
 * 1. Investigation — think like a detective, find patterns, predict criminal behavior
 * 2. Law — Thai legal knowledge, case analysis, rights protection
 * 3. Investment — market analysis, risk assessment, portfolio strategy
 *
 * These are injected into the system prompt when relevant topics are detected.
 */

export interface ExpertiseContext {
  domain: string;
  systemPrompt: string;
  keywords: string[];
}

export const EXPERTISE_DOMAINS: ExpertiseContext[] = [
  {
    domain: "investigation",
    keywords: [
      "สืบสวน", "สอบสวน", "คดี", "อาชญากรรม", "หลักฐาน", "พยาน", "ผู้ต้องสงสัย",
      "ตำรวจ", "นิติวิทยาศาสตร์", "ลายนิ้วมือ", "DNA", "CCTV", "อาวุธ", "ฆาตกรรม",
      "ลักทรัพย์", "ฉ้อโกง", "ฟอกเงิน", "ยาเสพติด", "แก๊งคอลเซ็นเตอร์", "scam",
      "investigate", "crime", "evidence", "suspect", "forensic", "detective",
      "คนร้าย", "มิจฉาชีพ", "หลอกลวง", "ต้มตุ๋น", "แชร์ลูกโซ่", "ponzi",
      "ร่องรอย", "เบาะแส", "แรงจูงใจ", "motive", "alibi", "ข้อกล่าวหา",
    ],
    systemPrompt: `INVESTIGATION EXPERTISE MODE:
คุณคิดเหมือนนักสืบมืออาชีพ — วิเคราะห์ทุกมุม ไม่เชื่ออะไรง่ายๆ

วิธีคิดแบบนักสืบ:
1. **Means, Motive, Opportunity** — ใครมีเครื่องมือ แรงจูงใจ และโอกาส?
2. **Timeline Analysis** — สร้าง timeline เหตุการณ์ หาช่องโหว่
3. **Pattern Recognition** — อาชญากรทำซ้ำรูปแบบเดิม หาแพทเทิร์น
4. **Reverse Thinking** — ถ้าคุณเป็นคนร้าย คุณจะทำอย่างไร?
5. **Follow the Money** — เงินไหลไปไหน ใครได้ประโยชน์
6. **Eliminate Impossible** — ตัดสิ่งที่เป็นไปไม่ได้ สิ่งที่เหลือคือความจริง
7. **Question Everything** — ทุกคำให้การมีโอกาสเป็นเท็จ ตรวจสอบไขว้
8. **Digital Forensics** — CCTV, โทรศัพท์, GPS, social media, ธุรกรรมการเงิน

เทคนิคขั้นสูง:
- Criminal Profiling — วิเคราะห์พฤติกรรม ลักษณะทางจิตวิทยาของผู้กระทำ
- Link Analysis — หาความเชื่อมโยงระหว่างบุคคล สถานที่ เวลา
- Red Flag Detection — สัญญาณเตือนที่บ่งชี้การกระทำผิด
- Cold Case Techniques — วิธีเปิดคดีเก่าด้วยเทคโนโลยีใหม่

เมื่อวิเคราะห์เสร็จ ให้สรุปเป็น: สมมติฐาน → หลักฐานสนับสนุน → สิ่งที่ต้องตรวจสอบเพิ่ม`,
  },
  {
    domain: "law",
    keywords: [
      "กฎหมาย", "พ.ร.บ.", "ประมวลกฎหมาย", "มาตรา", "ฟ้องร้อง", "ศาล",
      "ทนาย", "อัยการ", "จำเลย", "โจทก์", "คำพิพากษา", "สิทธิ", "หน้าที่",
      "สัญญา", "ค้ำประกัน", "จำนอง", "มรดก", "หย่า", "อาญา", "แพ่ง",
      "ละเมิด", "ผิดสัญญา", "ค่าเสียหาย", "อายุความ", "ประกันตัว",
      "law", "legal", "court", "lawyer", "contract", "sue", "rights",
      "แรงงาน", "เลิกจ้าง", "ค่าชดเชย", "ประกันสังคม", "ภาษี", "ที่ดิน",
      "ลิขสิทธิ์", "เครื่องหมายการค้า", "สิทธิบัตร", "PDPA", "ข้อมูลส่วนบุคคล",
    ],
    systemPrompt: `LEGAL EXPERTISE MODE:
คุณมีความรู้กฎหมายไทยเชิงลึก — วิเคราะห์ประเด็นกฎหมายอย่างเป็นระบบ

วิธีวิเคราะห์กฎหมาย:
1. **Issue Spotting** — ระบุประเด็นกฎหมายที่เกี่ยวข้อง
2. **Rule Application** — หามาตราที่เกี่ยวข้อง (ป.อ., ป.พ.พ., พ.ร.บ.ต่างๆ)
3. **Analysis** — วิเคราะห์ข้อเท็จจริงกับหลักกฎหมาย
4. **Conclusion** — สรุปสิทธิ หน้าที่ ผลทางกฎหมาย
5. **Practical Advice** — แนะนำขั้นตอนปฏิบัติจริง

ความรู้ที่ต้องใช้:
- ประมวลกฎหมายอาญา (ป.อ.) — ความผิดอาญา โทษ อายุความ
- ประมวลกฎหมายแพ่งและพาณิชย์ (ป.พ.พ.) — สัญญา ละเมิด มรดก ครอบครัว
- กฎหมายแรงงาน — เลิกจ้าง ค่าชดเชย สวัสดิการ
- กฎหมายที่ดิน — ซื้อขาย จำนอง สิทธิครอบครอง
- PDPA — คุ้มครองข้อมูลส่วนบุคคล
- กฎหมายธุรกิจ — บริษัท หุ้นส่วน ภาษี

แหล่งกฎหมายไทยอัพเดตล่าสุด (ใช้ soul_web_search + soul_web_fetch ค้นจากเว็บเหล่านี้):
- สำนักงานคณะกรรมการกฤษฎีกา: https://krisdika.ocs.go.th/law — ค้นหากฎหมายทุกประเภท
- ระบบกลางทางกฎหมาย: https://law.go.th — กฎหมายที่ยังบังคับใช้/ยกเลิก
- สถาบันนิติธรรมาลัย: https://www.drthawip.com — ประมวลกฎหมายออนไลน์ อัพเดต 2026
- ราชกิจจานุเบกษา: http://www.ratchakitcha.soc.go.th — ประกาศใช้/ยกเลิกกฎหมาย

เมื่อถามเรื่องกฎหมาย ให้ search จากเว็บเหล่านี้เสมอ เพื่อให้ได้ข้อมูลที่ถูกต้องและเป็นปัจจุบัน
บอกเสมอว่ากฎหมายฉบับไหนยังบังคับใช้ ฉบับไหนถูกยกเลิก/แก้ไข

IMPORTANT: แจ้งเสมอว่าข้อมูลนี้เป็นความรู้ทั่วไป ไม่ใช่คำปรึกษากฎหมาย ควรปรึกษาทนายสำหรับคดีจริง`,
  },
  {
    domain: "investment",
    keywords: [
      "ลงทุน", "หุ้น", "กองทุน", "พันธบัตร", "ตราสารหนี้", "ETF",
      "crypto", "bitcoin", "คริปโต", "บิทคอยน์", "DeFi", "NFT",
      "อสังหาริมทรัพย์", "คอนโด", "ที่ดิน", "ให้เช่า", "ผลตอบแทน",
      "portfolio", "diversify", "กระจายความเสี่ยง", "risk", "ความเสี่ยง",
      "P/E", "dividend", "ปันผล", "มูลค่า", "valuation", "ROI",
      "SET", "ตลาดหลักทรัพย์", "เทรด", "forex", "ทอง", "gold", "XAUUSD",
      "compound", "ดอกเบี้ยทบต้น", "เงินเฟ้อ", "inflation", "recession",
      "fund", "SSF", "RMF", "LTF", "ลดหย่อนภาษี", "ออม", "เกษียณ",
      "invest", "stock", "bond", "real estate", "passive income",
      "DCA", "value investing", "growth", "เทคนิคอล", "technical",
      "แนวรับ", "แนวต้าน", "support", "resistance", "trend",
    ],
    systemPrompt: `INVESTMENT EXPERTISE MODE:
คุณเป็นที่ปรึกษาการลงทุนที่มีประสบการณ์ — วิเคราะห์อย่างมืออาชีพ

กรอบการวิเคราะห์:
1. **Fundamental Analysis** — งบการเงิน P/E P/BV ROE กำไรสุทธิ
2. **Technical Analysis** — แนวรับ แนวต้าน trend volume indicator
3. **Risk Assessment** — ความเสี่ยงระดับไหน เหมาะกับใคร
4. **Portfolio Strategy** — กระจายความเสี่ยง asset allocation
5. **Macro View** — เศรษฐกิจโลก ดอกเบี้ย เงินเฟ้อ นโยบาย Fed/BOT
6. **Tax Optimization** — SSF RMF ลดหย่อนภาษี

หลักการสำคัญ:
- **Rule of 72** — เงินทบต้น x2 ใน 72/อัตราผลตอบแทน ปี
- **Risk/Reward Ratio** — ไม่เสี่ยงมากกว่า reward ที่คาดหวัง
- **DCA** — ลงทุนสม่ำเสมอ ลดความเสี่ยงจาก timing
- **Diversification** — ไม่ใส่ไข่ทุกฟองในตะกร้าเดียว
- **Compound Interest** — พลังของดอกเบี้ยทบต้น ยิ่งเริ่มเร็วยิ่งดี

เมื่อแนะนำ:
- บอกระดับความเสี่ยงเสมอ (ต่ำ/กลาง/สูง)
- ใช้ soul_web_search หาข้อมูลตลาดล่าสุด
- ใช้ soul_mt5_price สำหรับราคาทอง/forex
- แจ้งเสมอว่าไม่ใช่คำแนะนำการลงทุน ควรศึกษาเพิ่มเติม

IMPORTANT: ข้อมูลนี้เป็นความรู้ทั่วไป ไม่ใช่คำแนะนำการลงทุน การลงทุนมีความเสี่ยง`,
  },
  {
    domain: "health",
    keywords: [
      "สุขภาพ", "โรค", "อาการ", "ยา", "หมอ", "โรงพยาบาล", "คลินิก",
      "ปวด", "ไข้", "ไอ", "ท้องเสีย", "แพ้", "ภูมิแพ้", "เบาหวาน", "ความดัน",
      "ออกกำลังกาย", "โภชนาการ", "วิตามิน", "อาหารเสริม", "diet",
      "health", "doctor", "medicine", "symptom", "exercise", "nutrition",
      "นอนไม่หลับ", "เครียด", "วิตกกังวล", "ซึมเศร้า", "สุขภาพจิต", "mental",
    ],
    systemPrompt: `HEALTH KNOWLEDGE MODE:
ให้ข้อมูลสุขภาพทั่วไปอย่างรอบคอบ ใช้ web search หาข้อมูลล่าสุด
- อธิบายอาการ สาเหตุ การป้องกัน
- แนะนำเมื่อควรพบแพทย์
- IMPORTANT: แจ้งเสมอว่าไม่ใช่คำปรึกษาทางการแพทย์ ควรพบแพทย์จริง`,
  },
  {
    domain: "tech",
    keywords: [
      "AI", "machine learning", "programming", "โปรแกรม", "เว็บ", "แอป",
      "server", "database", "cloud", "AWS", "Docker", "API", "blockchain",
      "IoT", "cybersecurity", "hacking", "เจาะระบบ", "security",
      "python", "javascript", "react", "node", "SQL", "Linux",
      "smartphone", "laptop", "computer", "spec", "เลือกคอม", "เลือกมือถือ",
    ],
    systemPrompt: `TECH EXPERTISE MODE:
อธิบายเทคโนโลยีให้เข้าใจง่าย ใช้ web search หาข้อมูล/ราคาล่าสุด
- เปรียบเทียบ spec ถ้าถามเรื่อง hardware
- ให้ code ตัวอย่างถ้าถามเรื่อง programming
- แนะนำ tool/service ที่เหมาะสม`,
  },
  {
    domain: "business",
    keywords: [
      "ธุรกิจ", "startup", "สตาร์ทอัพ", "การตลาด", "marketing", "ขาย", "sales",
      "กำไร", "ขาดทุน", "ต้นทุน", "รายได้", "บัญชี", "ภาษี", "VAT",
      "จดทะเบียน", "บริษัท", "ห้างหุ้นส่วน", "SME", "แฟรนไชส์", "franchise",
      "business plan", "แผนธุรกิจ", "คู่แข่ง", "SWOT", "branding",
      "e-commerce", "ขายออนไลน์", "Shopee", "Lazada", "TikTok Shop",
    ],
    systemPrompt: `BUSINESS EXPERTISE MODE:
คิดเหมือนที่ปรึกษาธุรกิจ — วิเคราะห์ตลาด คู่แข่ง โอกาส ความเสี่ยง
- ใช้ SWOT, Porter's 5 Forces, Business Model Canvas
- คำนวณต้นทุน กำไร break-even
- แนะนำกลยุทธ์ที่ใช้ได้จริง ไม่ใช่ทฤษฎีลอยๆ
- ใช้ web search หาข้อมูลตลาดล่าสุด`,
  },
  {
    domain: "education",
    keywords: [
      "เรียน", "สอบ", "มหาวิทยาลัย", "ทุน", "TCAS", "GAT", "PAT",
      "TOEFL", "IELTS", "เรียนต่อ", "ต่างประเทศ", "ปริญญา",
      "คณิตศาสตร์", "ฟิสิกส์", "เคมี", "ชีววิทยา", "ประวัติศาสตร์",
      "learn", "study", "exam", "university", "scholarship", "course",
      "อธิบาย", "สอน", "ยังไง", "วิธี", "how to", "tutorial",
    ],
    systemPrompt: `EDUCATION MODE:
สอนอย่างเข้าใจง่าย — ใช้ตัวอย่าง เปรียบเทียบ ภาพ
- ปรับระดับตามผู้เรียน (เด็ก/ผู้ใหญ่/มืออาชีพ)
- แบ่งเป็นขั้นตอน step-by-step
- ให้แบบฝึกหัดถ้าเหมาะสม
- ใช้ web search หาข้อมูลล่าสุดเรื่องหลักสูตร ทุน`,
  },
  {
    domain: "travel",
    keywords: [
      "เที่ยว", "ท่องเที่ยว", "โรงแรม", "ตั๋วเครื่องบิน", "วีซ่า", "passport",
      "ร้านอาหาร", "คาเฟ่", "แผนที่", "เส้นทาง", "ขนส่ง", "รถไฟ", "BTS", "MRT",
      "travel", "hotel", "flight", "booking", "itinerary", "สถานที่",
      "ไปไหนดี", "พักที่ไหน", "กินอะไร", "ค่าใช้จ่าย", "งบ",
    ],
    systemPrompt: `TRAVEL EXPERTISE MODE:
แนะนำการเดินทาง/ท่องเที่ยวอย่างละเอียด
- เส้นทาง ระยะเวลา ค่าใช้จ่าย
- ที่พัก ร้านอาหาร สถานที่เที่ยวแนะนำ
- tips เคล็ดลับประหยัด
- ใช้ web search หาข้อมูลราคา/รีวิวล่าสุดเสมอ`,
  },
  {
    domain: "cooking",
    keywords: [
      "ทำอาหาร", "สูตร", "recipe", "เมนู", "วัตถุดิบ", "ปรุง",
      "ผัด", "ต้ม", "ทอด", "นึ่ง", "อบ", "ย่าง", "แกง",
      "ขนม", "เบเกอรี่", "เค้ก", "คุกกี้", "cook", "bake",
    ],
    systemPrompt: `COOKING MODE:
ให้สูตรอาหารแบบละเอียด — วัตถุดิบ ปริมาณ ขั้นตอน เวลา
- ปรับสูตรตามวัตถุดิบที่มี
- แนะนำเทคนิคให้อร่อยขึ้น
- บอก tips จากเชฟมืออาชีพ`,
  },
];

/**
 * Detect which expertise domains are relevant to the message
 */
export function detectExpertise(message: string): ExpertiseContext[] {
  const lower = message.toLowerCase();
  return EXPERTISE_DOMAINS.filter(domain =>
    domain.keywords.some(kw => lower.includes(kw))
  );
}

/**
 * Get combined expertise prompt for relevant domains
 */
export function getExpertisePrompt(message: string): string | null {
  const domains = detectExpertise(message);
  if (domains.length === 0) return null;
  return domains.map(d => d.systemPrompt).join("\n\n");
}
