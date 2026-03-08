import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addPerson, findPerson, listPeople,
  updatePerson, getPeopleStats,
} from "../core/people-memory.js";

export function registerPeopleTools(server: McpServer) {
  server.tool(
    "soul_person_add",
    "Remember a person — Soul tracks people master mentions (name, role, relationship, notes). Updates existing if found.",
    {
      name: z.string().describe("Person's name"),
      nickname: z.string().optional().describe("Nickname or alias"),
      role: z.string().optional().describe("Role (e.g., 'colleague', 'boss', 'friend', 'client')"),
      relationship: z.enum(["family", "friend", "colleague", "client", "mentor", "acquaintance", "other"])
        .default("acquaintance").describe("Relationship to master"),
      notes: z.string().optional().describe("Notes about this person"),
      traits: z.array(z.string()).optional().describe("Personality traits or characteristics"),
    },
    async ({ name, nickname, role, relationship, notes, traits }) => {
      const person = await addPerson({ name, nickname, role, relationship, notes, traits });
      return {
        content: [{
          type: "text" as const,
          text: `${person.mentionCount > 1 ? "Updated" : "Remembered"}: ${person.name}${person.role ? ` (${person.role})` : ""} [${person.relationship}]${notes ? `\nNotes: ${notes}` : ""}`,
        }],
      };
    }
  );

  server.tool(
    "soul_person_find",
    "Find a person by name — recall everything Soul knows about them.",
    {
      name: z.string().describe("Name or nickname to search"),
    },
    async ({ name }) => {
      const person = findPerson(name);
      if (!person) {
        return { content: [{ type: "text" as const, text: `No one named "${name}" found.` }] };
      }

      let text = `${person.name}`;
      if (person.nickname) text += ` ("${person.nickname}")`;
      text += `\nRole: ${person.role || "Unknown"}`;
      text += `\nRelationship: ${person.relationship}`;
      text += `\nMentioned: ${person.mentionCount}x (last: ${person.lastMentioned})`;
      if (person.notes) text += `\n\nNotes:\n${person.notes}`;

      try {
        const traits = JSON.parse(person.traits);
        if (traits.length > 0) text += `\nTraits: ${traits.join(", ")}`;
      } catch { /* skip */ }

      try {
        const dates = JSON.parse(person.importantDates);
        const entries = Object.entries(dates);
        if (entries.length > 0) {
          text += `\nImportant dates:`;
          entries.forEach(([label, date]) => { text += `\n  ${label}: ${date}`; });
        }
      } catch { /* skip */ }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_people",
    "List all remembered people — filter by relationship type.",
    {
      relationship: z.string().optional().describe("Filter (family, friend, colleague, client, mentor, acquaintance)"),
    },
    async ({ relationship }) => {
      const people = listPeople(relationship);
      if (people.length === 0) {
        return { content: [{ type: "text" as const, text: "No people remembered yet. Use soul_person_add." }] };
      }

      const text = people.map(p =>
        `#${p.id} ${p.name}${p.nickname ? ` (${p.nickname})` : ""} — ${p.relationship}${p.role ? `, ${p.role}` : ""} [${p.mentionCount}x]`
      ).join("\n");

      return { content: [{ type: "text" as const, text: `People (${people.length}):\n\n${text}` }] };
    }
  );

  server.tool(
    "soul_person_update",
    "Update info about a person — add notes, change role, add important dates.",
    {
      id: z.number().describe("Person ID"),
      notes: z.string().optional().describe("Additional notes to append"),
      role: z.string().optional().describe("Updated role"),
      relationship: z.string().optional().describe("Updated relationship"),
      traits: z.array(z.string()).optional().describe("Updated traits"),
      importantDates: z.record(z.string(), z.string()).optional().describe("Important dates (e.g., {birthday: '1990-05-15'})"),
    },
    async ({ id, notes, role, relationship, traits, importantDates }) => {
      const person = await updatePerson(id, { notes, role, relationship, traits, importantDates: importantDates as Record<string, string> | undefined });
      if (!person) return { content: [{ type: "text" as const, text: "Person not found." }] };
      return { content: [{ type: "text" as const, text: `Updated: ${person.name}` }] };
    }
  );

  server.tool(
    "soul_people_stats",
    "People statistics — how many people Soul remembers, by relationship.",
    {},
    async () => {
      const stats = getPeopleStats();
      let text = `=== People Memory ===\n\nTotal: ${stats.total}\n\n`;
      text += `By Relationship:\n`;
      for (const [rel, count] of Object.entries(stats.byRelationship)) {
        text += `  ${rel}: ${count}\n`;
      }
      if (stats.recentlyMentioned.length > 0) {
        text += `\nRecently Mentioned:\n`;
        stats.recentlyMentioned.forEach(p => { text += `  ${p.name} (${p.lastMentioned})\n`; });
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
