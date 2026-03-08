import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addTeamMember, authenticateTeamMember, listTeamMembers, updateTeamMember,
  classifyResource, canAccess, autoClassify, getClassification,
  createCompartment, addToCompartment, listCompartments,
  getAuditLog, getClassificationDashboard,
  teachClassification, feedbackClassification, smartClassify,
  listLearnedPatterns, forgetPattern, getClassificationLearningStats,
  CLASSIFICATION_LABELS,
  type ClassificationLevel, type UserRole,
} from "../core/classification.js";

export function registerClassificationTools(server: McpServer) {

  // ─── 1. Team Management ───

  server.tool(
    "soul_team_add",
    "Add a team member with role and clearance level. For law enforcement teams sharing Soul.",
    {
      username: z.string().describe("Login username"),
      displayName: z.string().describe("Display name (e.g. 'พ.ต.ท. สมชาย')"),
      password: z.string().describe("Password"),
      role: z.enum(["admin", "analyst", "viewer"]).describe("Role: admin=full, analyst=classify+view, viewer=read-only"),
      clearanceLevel: z.enum(["unclassified", "confidential", "secret", "top_secret"])
        .describe("Clearance: unclassified=ปกติ, confidential=ลับ, secret=ลับมาก, top_secret=ลับที่สุด"),
      department: z.string().optional().describe("Department/unit name"),
    },
    async ({ username, displayName, password, role, clearanceLevel, department }) => {
      try {
        const member = addTeamMember({ username, displayName, password, role, clearanceLevel, department });
        const label = CLASSIFICATION_LABELS[clearanceLevel];
        return { content: [{ type: "text" as const, text:
          `✅ เพิ่มสมาชิกทีม: ${displayName} (@${username})\n` +
          `   Role: ${role}\n` +
          `   Clearance: ${label.icon} ${label.th} (${label.en})\n` +
          `   Department: ${department || "-"}`
        }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  server.tool(
    "soul_team_list",
    "List all team members with roles and clearance levels.",
    {},
    async () => {
      const members = listTeamMembers();
      if (members.length === 0) {
        return { content: [{ type: "text" as const, text: "No team members yet. Use soul_team_add to add the first member." }] };
      }
      let text = `=== Team Members (${members.length}) ===\n\n`;
      for (const m of members) {
        const label = CLASSIFICATION_LABELS[m.clearanceLevel as ClassificationLevel];
        const status = m.isActive ? "✅" : "❌";
        text += `${status} ${m.displayName} (@${m.username})\n`;
        text += `   Role: ${m.role} | Clearance: ${label.icon} ${label.th}\n`;
        text += `   Dept: ${m.department || "-"} | Last login: ${m.lastLogin || "never"}\n\n`;
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_team_auth",
    "Authenticate a team member — verify username and password.",
    {
      username: z.string().describe("Username"),
      password: z.string().describe("Password"),
    },
    async ({ username, password }) => {
      const member = authenticateTeamMember(username, password);
      if (!member) {
        return { content: [{ type: "text" as const, text: "❌ Authentication failed." }] };
      }
      const label = CLASSIFICATION_LABELS[member.clearanceLevel as ClassificationLevel];
      return { content: [{ type: "text" as const, text:
        `✅ ยืนยันตัวตนสำเร็จ: ${member.displayName}\n` +
        `   Role: ${member.role} | Clearance: ${label.icon} ${label.th}\n` +
        `   User ID: ${member.id}`
      }] };
    }
  );

  server.tool(
    "soul_team_update",
    "Update a team member's role, clearance, or status.",
    {
      userId: z.number().describe("Team member ID"),
      role: z.enum(["admin", "analyst", "viewer"]).optional().describe("New role"),
      clearanceLevel: z.enum(["unclassified", "confidential", "secret", "top_secret"]).optional().describe("New clearance"),
      department: z.string().optional().describe("New department"),
      isActive: z.boolean().optional().describe("Active status (false = disabled)"),
    },
    async ({ userId, role, clearanceLevel, department, isActive }) => {
      const ok = updateTeamMember(userId, { role, clearanceLevel, department, isActive });
      return { content: [{ type: "text" as const, text: ok ? "✅ Updated." : "❌ User not found." }] };
    }
  );

  // ─── 2. Data Classification ───

  server.tool(
    "soul_classify",
    "Classify a piece of data (memory, knowledge, note) with a security level. ลับ/ลับมาก/ลับที่สุด",
    {
      resourceType: z.enum(["memory", "knowledge", "note", "case", "person"]).describe("Type of resource"),
      resourceId: z.number().describe("Resource ID"),
      classification: z.enum(["unclassified", "confidential", "secret", "top_secret"])
        .describe("Level: unclassified=ปกติ, confidential=ลับ, secret=ลับมาก, top_secret=ลับที่สุด"),
      classifiedBy: z.number().describe("Your user ID (from soul_team_auth)"),
      reason: z.string().describe("Reason for classification"),
      compartment: z.string().optional().describe("Restrict to specific case/compartment"),
    },
    async ({ resourceType, resourceId, classification, classifiedBy, reason, compartment }) => {
      try {
        const result = classifyResource({ resourceType, resourceId, classification, classifiedBy, reason, compartment });
        const label = CLASSIFICATION_LABELS[classification];
        return { content: [{ type: "text" as const, text:
          `${label.icon} Classified: ${resourceType} #${resourceId}\n` +
          `   Level: ${label.th} (${label.en})\n` +
          `   Reason: ${reason}\n` +
          (compartment ? `   Compartment: ${compartment}\n` : "") +
          `   By user #${classifiedBy}`
        }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  server.tool(
    "soul_classify_check",
    "Check if a user can access classified data. Verifies clearance level and compartment membership.",
    {
      userId: z.number().describe("User ID to check"),
      resourceType: z.enum(["memory", "knowledge", "note", "case", "person"]).describe("Type"),
      resourceId: z.number().describe("Resource ID"),
    },
    async ({ userId, resourceType, resourceId }) => {
      const result = canAccess(userId, resourceType, resourceId);
      const classification = getClassification(resourceType, resourceId);
      const level = classification?.classification || "unclassified";
      const label = CLASSIFICATION_LABELS[level as ClassificationLevel];

      return { content: [{ type: "text" as const, text:
        `${result.allowed ? "✅" : "🔴"} ${result.allowed ? "ACCESS GRANTED" : "ACCESS DENIED"}\n` +
        `   Resource: ${resourceType} #${resourceId}\n` +
        `   Classification: ${label.icon} ${label.th}\n` +
        `   ${result.reason}`
      }] };
    }
  );

  server.tool(
    "soul_classify_auto",
    "Auto-detect the classification level of text. Analyzes content for sensitive patterns (Thai + English).",
    {
      text: z.string().describe("Text to analyze for sensitivity"),
    },
    async ({ text }) => {
      const result = autoClassify(text);
      const label = CLASSIFICATION_LABELS[result.suggestedLevel];

      let output = `${label.icon} Suggested: ${label.th} (${label.en})\n\n`;

      if (result.matches.length > 0) {
        output += `Detected patterns:\n`;
        for (const m of result.matches) {
          const ml = CLASSIFICATION_LABELS[m.level];
          output += `  ${ml.icon} [${m.category}] "${m.matched}" → ${ml.th}\n`;
        }
      } else {
        output += `No sensitive patterns detected. Safe as unclassified.`;
      }

      return { content: [{ type: "text" as const, text: output }] };
    }
  );

  // ─── 3. Compartments ───

  server.tool(
    "soul_compartment_create",
    "Create a case compartment — restrict data access to specific team members only.",
    {
      name: z.string().describe("Compartment name (e.g. 'CASE-2024-001', 'OP-DRAGON')"),
      description: z.string().describe("Description"),
      ownerId: z.number().describe("Owner user ID"),
      memberIds: z.array(z.number()).describe("User IDs who can access this compartment"),
    },
    async ({ name, description, ownerId, memberIds }) => {
      createCompartment(name, description, ownerId, memberIds);
      return { content: [{ type: "text" as const, text:
        `🔒 Compartment "${name}" created\n` +
        `   Members: ${memberIds.length} users\n` +
        `   Owner: user #${ownerId}\n\n` +
        `Use soul_classify with compartment="${name}" to restrict data to this group.`
      }] };
    }
  );

  server.tool(
    "soul_compartment_add_member",
    "Add a user to a case compartment.",
    {
      compartmentName: z.string().describe("Compartment name"),
      userId: z.number().describe("User ID to add"),
    },
    async ({ compartmentName, userId }) => {
      try {
        addToCompartment(compartmentName, userId);
        return { content: [{ type: "text" as const, text: `✅ User #${userId} added to "${compartmentName}"` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  server.tool(
    "soul_compartments",
    "List all case compartments.",
    {},
    async () => {
      const comps = listCompartments();
      if (comps.length === 0) {
        return { content: [{ type: "text" as const, text: "No compartments yet." }] };
      }
      let text = `=== Compartments (${comps.length}) ===\n\n`;
      for (const c of comps) {
        text += `🔒 ${c.name}\n   ${c.description}\n   Owner: ${c.ownerName} | Members: ${c.memberCount}\n\n`;
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 4. Audit Trail ───

  server.tool(
    "soul_audit",
    "View security audit trail — who accessed what, when. Admin only.",
    {
      userId: z.number().optional().describe("Filter by user ID"),
      resource: z.string().optional().describe("Filter by resource type"),
      classification: z.enum(["unclassified", "confidential", "secret", "top_secret"]).optional().describe("Filter by level"),
      limit: z.number().default(20).describe("Max results"),
    },
    async ({ userId, resource, classification, limit }) => {
      const entries = getAuditLog({ userId, resource, classification, limit });
      if (entries.length === 0) {
        return { content: [{ type: "text" as const, text: "No audit entries found." }] };
      }
      let text = `=== Audit Trail (${entries.length}) ===\n\n`;
      for (const e of entries) {
        const label = CLASSIFICATION_LABELS[e.classification as ClassificationLevel];
        text += `${e.timestamp} | ${e.username} | ${e.action}\n`;
        text += `  ${label.icon} ${e.resource}:${e.resourceId} | ${e.details}\n\n`;
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 5. Dashboard ───

  server.tool(
    "soul_classify_dashboard",
    "Security classification dashboard — team overview, classified items, recent activity.",
    {},
    async () => {
      const d = getClassificationDashboard();

      let text = `╔══════════════════════════════════════╗\n`;
      text += `║    CLASSIFICATION DASHBOARD           ║\n`;
      text += `╠══════════════════════════════════════╣\n`;
      text += `║  Team size:      ${String(d.teamSize).padEnd(19)}║\n`;
      text += `║  Compartments:   ${String(d.compartments).padEnd(19)}║\n`;
      text += `╠══════════════════════════════════════╣\n`;
      text += `║  BY ROLE:                            ║\n`;
      for (const [role, count] of Object.entries(d.byRole)) {
        text += `║    ${role.padEnd(15)} ${String(count).padEnd(18)}║\n`;
      }
      text += `╠══════════════════════════════════════╣\n`;
      text += `║  CLASSIFIED ITEMS:                   ║\n`;
      for (const [level, count] of Object.entries(d.classifiedItems)) {
        const label = CLASSIFICATION_LABELS[level as ClassificationLevel];
        text += `║    ${label.icon} ${label.th.padEnd(12)} ${String(count).padEnd(18)}║\n`;
      }
      text += `╠══════════════════════════════════════╣\n`;
      text += `║  RECENT ACTIVITY:                    ║\n`;
      for (const e of d.recentAudit.slice(0, 5)) {
        text += `║  ${e.username.padEnd(10)} ${e.action.padEnd(10)} ${e.resource.padEnd(10)}  ║\n`;
      }
      text += `╚══════════════════════════════════════╝\n`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 6. Learning-Based Classification ───

  server.tool(
    "soul_classify_teach",
    "Teach Soul a new keyword/phrase → classification mapping. สอน Soul ว่าคำนี้ควรเป็นระดับไหน",
    {
      keyword: z.string().describe("Keyword or phrase to learn (e.g. 'แก๊งคอลเซ็นเตอร์', 'romance scam')"),
      classification: z.enum(["unclassified", "confidential", "secret", "top_secret"])
        .describe("Classification level for this keyword"),
      category: z.string().optional().describe("Category (e.g. 'scam_type', 'evidence', 'financial')"),
      example: z.string().optional().describe("Example sentence containing this keyword"),
      taughtBy: z.number().describe("Your user ID (from soul_team_auth)"),
    },
    async ({ keyword, classification, category, example, taughtBy }) => {
      try {
        const result = teachClassification({ keyword, classification, category, example, taughtBy });
        const label = CLASSIFICATION_LABELS[classification];
        return { content: [{ type: "text" as const, text:
          `${label.icon} ${result.isNew ? "เรียนรู้คำใหม่" : "เพิ่มน้ำหนัก"}: "${result.keyword}" → ${label.th}\n` +
          (example ? `   ตัวอย่าง: "${example.substring(0, 80)}"` : "")
        }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  server.tool(
    "soul_classify_feedback",
    "Correct Soul's auto-classification — Soul learns from the correction. แก้ไข Soul แล้ว Soul จะเรียนรู้",
    {
      text: z.string().describe("The text that was mis-classified"),
      originalLevel: z.enum(["unclassified", "confidential", "secret", "top_secret"])
        .describe("What Soul originally suggested"),
      correctedLevel: z.enum(["unclassified", "confidential", "secret", "top_secret"])
        .describe("What it SHOULD be"),
      correctedBy: z.number().describe("Your user ID"),
      reason: z.string().optional().describe("Why this classification is correct"),
    },
    async ({ text, originalLevel, correctedLevel, correctedBy, reason }) => {
      const result = feedbackClassification({ text, originalLevel, correctedLevel, correctedBy, reason });
      const origLabel = CLASSIFICATION_LABELS[originalLevel];
      const corrLabel = CLASSIFICATION_LABELS[correctedLevel];
      return { content: [{ type: "text" as const, text:
        `📝 Feedback recorded\n` +
        `   ${origLabel.icon} ${origLabel.th} → ${corrLabel.icon} ${corrLabel.th}\n` +
        `   ${result.message}`
      }] };
    }
  );

  server.tool(
    "soul_classify_smart",
    "Smart auto-classify — uses BOTH built-in rules AND learned patterns from team feedback. ฉลาดกว่า soul_classify_auto",
    {
      text: z.string().describe("Text to analyze"),
    },
    async ({ text }) => {
      const result = smartClassify(text);
      const label = CLASSIFICATION_LABELS[result.suggestedLevel];
      const pct = Math.round(result.confidence * 100);

      let output = `${label.icon} Suggested: ${label.th} (${label.en}) — ${pct}% confidence\n\n`;

      if (result.matches.length > 0) {
        output += `Detected patterns:\n`;
        for (const m of result.matches) {
          const ml = CLASSIFICATION_LABELS[m.level];
          const src = m.source === "learned" ? " [learned]" : "";
          output += `  ${ml.icon} [${m.category}] "${m.matched}" → ${ml.th}${src}\n`;
        }
      } else {
        output += `No sensitive patterns detected. Safe as unclassified.\n`;
      }

      output += `\n💡 Use soul_classify_feedback to correct if wrong — Soul will learn!`;
      return { content: [{ type: "text" as const, text: output }] };
    }
  );

  server.tool(
    "soul_classify_patterns",
    "List all learned classification patterns. ดูคำที่ Soul เรียนรู้มา",
    {
      classification: z.enum(["unclassified", "confidential", "secret", "top_secret"]).optional().describe("Filter by level"),
      limit: z.number().default(50).describe("Max results"),
    },
    async ({ classification, limit }) => {
      const patterns = listLearnedPatterns({ classification, limit });
      if (patterns.length === 0) {
        return { content: [{ type: "text" as const, text: "ยังไม่มี pattern ที่เรียนรู้ ใช้ soul_classify_teach เพื่อสอน Soul" }] };
      }

      let text = `=== Learned Patterns (${patterns.length}) ===\n\n`;
      for (const p of patterns) {
        const label = CLASSIFICATION_LABELS[p.classification as ClassificationLevel];
        text += `${label.icon} "${p.keyword}" → ${label.th} (weight: ${p.weight.toFixed(1)}, cat: ${p.category})\n`;
        if (p.examples.length > 0) {
          text += `   ex: "${p.examples[0].substring(0, 60)}"\n`;
        }
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_classify_forget",
    "Remove a learned pattern — Soul will forget this keyword.",
    {
      keyword: z.string().describe("Keyword to forget"),
      removedBy: z.number().describe("Your user ID"),
    },
    async ({ keyword, removedBy }) => {
      const ok = forgetPattern(keyword, removedBy);
      return { content: [{ type: "text" as const, text: ok ? `✅ ลบ pattern "${keyword}" แล้ว` : `❌ ไม่พบ "${keyword}"` }] };
    }
  );

  server.tool(
    "soul_classify_learning_stats",
    "View classification learning statistics — patterns learned, feedback received.",
    {},
    async () => {
      const s = getClassificationLearningStats();
      let text = `=== Classification Learning Stats ===\n\n`;
      text += `📚 Total learned patterns: ${s.totalPatterns}\n`;
      text += `📝 Total feedback: ${s.totalFeedback} (${s.recentFeedback} this week)\n\n`;

      if (Object.keys(s.byLevel).length > 0) {
        text += `By level:\n`;
        for (const [level, count] of Object.entries(s.byLevel)) {
          const label = CLASSIFICATION_LABELS[level as ClassificationLevel];
          text += `  ${label.icon} ${label.th}: ${count} patterns\n`;
        }
      }

      if (s.topPatterns.length > 0) {
        text += `\nTop patterns (highest weight):\n`;
        for (const p of s.topPatterns) {
          const label = CLASSIFICATION_LABELS[p.classification as ClassificationLevel];
          text += `  ${label.icon} "${p.keyword}" (${p.weight.toFixed(1)})\n`;
        }
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
