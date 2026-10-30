import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env, invalidate, keys, redis } from "@instaauto/core";
import { prisma } from "@instaauto/db";
import { requireAuth } from "../plugins/auth.js";

const text = z.string().trim().min(1).max(1000);

const RuleBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean().default(true),
    trigger: z.enum(["COMMENT", "DM"]),
    matchType: z.enum(["ANY", "KEYWORD"]).default("KEYWORD"),
    keywords: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    mediaIds: z.array(z.string().trim().min(1).max(64)).max(200).default([]),
    replyTemplates: z.array(text).max(20).default([]),
    privateReplyTemplates: z.array(text).max(20).default([]),
    hideComment: z.boolean().default(false),
    deleteComment: z.boolean().default(false),
    quickReplies: z.array(z.string().trim().min(1).max(20)).max(13).default([]),
    replyMediaUrl: z.string().url().startsWith("https://").nullable().default(null),
    aiReply: z.boolean().default(false),
    aiInstructions: z.string().trim().max(3000).nullable().default(null),
    priority: z.number().int().min(0).max(10_000).default(100),
  })
  .refine((r) => r.matchType === "ANY" || r.keywords.length > 0, "keywords required for KEYWORD rules")
  .refine(
    (r) => r.replyTemplates.length + r.privateReplyTemplates.length > 0 || r.hideComment || r.deleteComment || r.aiReply,
    "rule needs at least one action",
  )
  .refine(
    (r) => r.trigger === "COMMENT" || (r.privateReplyTemplates.length === 0 && !r.hideComment && !r.deleteComment && r.mediaIds.length === 0),
    "DM rules only support replyTemplates",
  )
  .refine((r) => r.trigger === "DM" || r.quickReplies.length === 0, "quick reply buttons are for DM rules only")
  .refine((r) => r.trigger === "DM" || !r.replyMediaUrl, "photo/video replies are for DM rules only")
  .refine((r) => !r.aiReply || Boolean(r.aiInstructions), "AI reply needs business info / instructions")
  .refine((r) => !r.aiReply || Boolean(env().GEMINI_API_KEY), "AI reply needs GEMINI_API_KEY in the server .env");

async function dropCache(accountId: string) {
  await invalidate(redis(), keys.rules(accountId, "COMMENT"), keys.rules(accountId, "DM"));
}

export default async function ruleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { id: string } }>("/accounts/:id/rules", async (req) =>
    prisma.automationRule.findMany({
      where: { accountId: req.params.id },
      orderBy: [{ trigger: "asc" }, { priority: "asc" }],
    }),
  );

  app.post<{ Params: { id: string } }>("/accounts/:id/rules", async (req, reply) => {
    const body = RuleBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid_body" });
    const rule = await prisma.automationRule.create({ data: { ...body.data, accountId: req.params.id } });
    await dropCache(req.params.id);
    return rule;
  });

  app.put<{ Params: { ruleId: string } }>("/rules/:ruleId", async (req, reply) => {
    const body = RuleBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid_body" });
    const rule = await prisma.automationRule.update({ where: { id: req.params.ruleId }, data: body.data });
    await dropCache(rule.accountId);
    return rule;
  });

  app.patch<{ Params: { ruleId: string } }>("/rules/:ruleId/toggle", async (req) => {
    const cur = await prisma.automationRule.findUniqueOrThrow({ where: { id: req.params.ruleId } });
    const rule = await prisma.automationRule.update({ where: { id: cur.id }, data: { enabled: !cur.enabled } });
    await dropCache(rule.accountId);
    return rule;
  });

  app.delete<{ Params: { ruleId: string } }>("/rules/:ruleId", async (req) => {
    const rule = await prisma.automationRule.delete({ where: { id: req.params.ruleId } });
    await dropCache(rule.accountId);
    return { ok: true };
  });
}
