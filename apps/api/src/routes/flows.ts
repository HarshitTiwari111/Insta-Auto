import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { invalidate, keys, redis, validateFlow } from "@instaauto/core";
import { prisma } from "@instaauto/db";
import { requireAuth } from "../plugins/auth.js";

const FlowBody = z.object({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  keywords: z.array(z.string().trim().min(1).max(100)).min(1, "add at least one keyword that starts the flow").max(50),
  steps: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        text: z.string().trim().min(1, "every step needs a message").max(1000),
        buttons: z.array(z.object({ title: z.string().trim().min(1).max(20), next: z.string().max(40).nullable() })).max(13),
      }),
    )
    .min(1)
    .max(30),
});

function parse(body: unknown) {
  const r = FlowBody.safeParse(body);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "invalid_body" } as const;
  const problems = validateFlow(r.data.steps);
  if (problems.length) return { error: problems[0]! } as const;
  return { data: r.data } as const;
}

/** DM chatbot flows (keyword -> step with buttons -> next step ...). */
export default async function flowRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { id: string } }>("/accounts/:id/flows", async (req) =>
    prisma.dmFlow.findMany({ where: { accountId: req.params.id }, orderBy: { createdAt: "asc" } }),
  );

  app.post<{ Params: { id: string } }>("/accounts/:id/flows", async (req, reply) => {
    const r = parse(req.body);
    if ("error" in r) return reply.code(400).send({ error: r.error });
    const flow = await prisma.dmFlow.create({ data: { ...r.data, accountId: req.params.id } });
    await invalidate(redis(), keys.flows(req.params.id));
    return flow;
  });

  app.put<{ Params: { flowId: string } }>("/flows/:flowId", async (req, reply) => {
    const r = parse(req.body);
    if ("error" in r) return reply.code(400).send({ error: r.error });
    const flow = await prisma.dmFlow.update({ where: { id: req.params.flowId }, data: r.data });
    await invalidate(redis(), keys.flows(flow.accountId));
    return flow;
  });

  app.delete<{ Params: { flowId: string } }>("/flows/:flowId", async (req) => {
    const flow = await prisma.dmFlow.delete({ where: { id: req.params.flowId } });
    await invalidate(redis(), keys.flows(flow.accountId));
    return { ok: true };
  });
}
