import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createGoal,
  updateGoal,
  getGoals,
  addReflection,
  getReflections,
  createHabit,
  completeHabit,
  getHabits,
  getMotivation,
  getAdvice,
} from "../core/life.js";

export function registerLifeTools(server: McpServer) {
  // === Goals ===

  server.tool(
    "soul_goal",
    "Set a life goal — career, health, relationships, learning, finance, creative, personal. Soul tracks your progress over time.",
    {
      title: z.string().describe("Goal title"),
      category: z
        .enum([
          "career",
          "health",
          "relationships",
          "learning",
          "finance",
          "creative",
          "personal",
        ])
        .describe("Life area"),
      description: z.string().describe("What you want to achieve"),
      targetDate: z
        .string()
        .optional()
        .describe("Target date (YYYY-MM-DD)"),
      milestones: z
        .array(z.string())
        .optional()
        .describe("Milestones along the way"),
    },
    async ({ title, category, description, targetDate, milestones }) => {
      const goal = await createGoal({
        title,
        category,
        description,
        targetDate,
        milestones,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Goal #${goal.id} set: "${title}" (${category})\n${description}${targetDate ? `\nTarget: ${targetDate}` : ""}${milestones && milestones.length > 0 ? `\nMilestones:\n${milestones.map((m) => `  - ${m}`).join("\n")}` : ""}\n\nUse soul_goal_update to track progress. Soul believes in you.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_goal_update",
    "Update progress on a life goal — add reflection, change progress percentage, or update status.",
    {
      goalId: z.number().describe("Goal ID"),
      progress: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Progress percentage (0-100)"),
      status: z
        .enum(["active", "paused", "achieved", "abandoned"])
        .optional()
        .describe("New status"),
      reflection: z
        .string()
        .optional()
        .describe("Reflection on progress"),
    },
    async ({ goalId, progress, status, reflection }) => {
      const goal = await updateGoal(goalId, { progress, status, reflection });
      if (!goal) {
        return {
          content: [
            { type: "text" as const, text: `Goal #${goalId} not found.` },
          ],
        };
      }

      let text = `Goal #${goal.id} updated: "${goal.title}"\n`;
      text += `Progress: ${goal.progress}% | Status: ${goal.status}`;
      if (reflection) text += `\nReflection: ${reflection}`;
      if (goal.status === "achieved") {
        text += `\n\nCongratulations! You achieved your goal! This is now part of Soul's wisdom.`;
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_goals",
    "View your life goals — see progress across all areas of life.",
    {
      status: z
        .enum(["active", "paused", "achieved", "abandoned"])
        .optional()
        .describe("Filter by status"),
      category: z
        .string()
        .optional()
        .describe("Filter by life area"),
    },
    async ({ status, category }) => {
      const goals = await getGoals(status, category);

      if (goals.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No goals set yet. Use soul_goal to start your journey.",
            },
          ],
        };
      }

      const text = goals
        .map((g) => {
          const filled = Math.round(g.progress / 10);
          const bar = `[${"#".repeat(filled)}${"-".repeat(10 - filled)}]`;
          return `#${g.id} ${bar} ${g.progress}% — ${g.title} (${g.category})\n  Status: ${g.status}${g.targetDate ? ` | Target: ${g.targetDate}` : ""}`;
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Life Goals (${goals.length}):\n\n${text}`,
          },
        ],
      };
    }
  );

  // === Daily Reflection ===

  server.tool(
    "soul_reflect_daily",
    "Daily reflection — record your mood, gratitude, what you learned, challenges, and plans for tomorrow. Soul tracks patterns over time.",
    {
      mood: z
        .string()
        .describe(
          "How are you feeling? (e.g., energized, calm, stressed, grateful, tired)"
        ),
      gratitude: z
        .string()
        .optional()
        .describe("What are you grateful for today?"),
      learned: z
        .string()
        .optional()
        .describe("What did you learn today?"),
      challenges: z
        .string()
        .optional()
        .describe("What challenges did you face?"),
      tomorrow: z
        .string()
        .optional()
        .describe("What's the plan for tomorrow?"),
    },
    async ({ mood, gratitude, learned, challenges, tomorrow }) => {
      const ref = await addReflection({
        mood,
        gratitude,
        learned,
        challenges,
        tomorrow,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Reflection recorded for ${ref.date}.\n\nMood: ${mood}${gratitude ? `\nGrateful for: ${gratitude}` : ""}${learned ? `\nLearned: ${learned}` : ""}${challenges ? `\nChallenges: ${challenges}` : ""}${tomorrow ? `\nTomorrow: ${tomorrow}` : ""}\n\nSoul remembers. These reflections build wisdom over time.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_reflections",
    "Review past reflections — see mood patterns, gratitude, and growth over time.",
    {
      days: z
        .number()
        .default(7)
        .describe("How many days to look back"),
    },
    async ({ days }) => {
      const refs = await getReflections(days);

      if (refs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No reflections yet. Use soul_reflect_daily to start your reflection practice.",
            },
          ],
        };
      }

      const text = refs
        .map(
          (r) =>
            `${r.date} — Mood: ${r.mood}${r.gratitude ? `\n  Grateful: ${r.gratitude}` : ""}${r.learned ? `\n  Learned: ${r.learned}` : ""}${r.challenges ? `\n  Challenges: ${r.challenges}` : ""}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Reflections (last ${refs.length} entries):\n\n${text}`,
          },
        ],
      };
    }
  );

  // === Habits ===

  server.tool(
    "soul_habit",
    "Create a habit to track — exercise, reading, meditation, coding, anything. Soul tracks your streaks.",
    {
      name: z.string().describe("Habit name"),
      category: z
        .string()
        .describe(
          "Category (health, learning, productivity, mindfulness, social, etc.)"
        ),
      frequency: z
        .enum(["daily", "weekly"])
        .default("daily")
        .describe("How often"),
    },
    async ({ name, category, frequency }) => {
      const habit = await createHabit({ name, category, frequency });
      return {
        content: [
          {
            type: "text" as const,
            text: `Habit created: "${name}" (${frequency})\nCategory: ${category}\n\nUse soul_habit_done to check it off. Build your streak!`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_habit_done",
    "Mark a habit as done for today — build your streak!",
    {
      habitId: z.number().describe("Habit ID"),
    },
    async ({ habitId }) => {
      const habit = await completeHabit(habitId);
      if (!habit) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Habit #${habitId} not found.`,
            },
          ],
        };
      }

      let text = `"${habit.name}" done!\n`;
      text += `Streak: ${habit.streak} days | Best: ${habit.bestStreak} | Total: ${habit.totalCompletions}`;

      if (habit.streak >= 7 && habit.streak % 7 === 0) {
        text += `\n\n${habit.streak} days! You're building a real habit. Keep it up!`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_habits",
    "View all your habits and streaks.",
    {},
    async () => {
      const habits = await getHabits();

      if (habits.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No habits tracked yet. Use soul_habit to start building good habits.",
            },
          ],
        };
      }

      const text = habits
        .map(
          (h) =>
            `#${h.id} "${h.name}" (${h.category})\n  Streak: ${h.streak} days | Best: ${h.bestStreak} | Total: ${h.totalCompletions}${h.lastCompleted ? ` | Last: ${h.lastCompleted.split("T")[0]}` : ""}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Your Habits (${habits.length}):\n\n${text}`,
          },
        ],
      };
    }
  );

  // === Motivation & Advice ===

  server.tool(
    "soul_motivate",
    "Get encouragement and see your progress — Soul tracks your goals, habits, and growth to motivate you.",
    {
      context: z
        .string()
        .optional()
        .describe("What you need motivation about"),
    },
    async ({ context }) => {
      const result = await getMotivation(context);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "soul_advice",
    "Ask Soul for life advice — career, relationships, health, personal growth, finance, or anything else. Soul draws from accumulated wisdom and multiple perspectives.",
    {
      topic: z
        .string()
        .describe("What you need advice about"),
      context: z
        .string()
        .optional()
        .describe("Additional context about your situation"),
    },
    async ({ topic, context }) => {
      const result = await getAdvice(topic, context);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
