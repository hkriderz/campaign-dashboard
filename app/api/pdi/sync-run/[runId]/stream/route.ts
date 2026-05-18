import {
  getSyncRun,
  subscribeSyncRun,
} from "@/lib/pdi-tools/sync/run-registry";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ runId: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const { runId } = await context.params;
  const run = getSyncRun(runId);

  if (!run) {
    return new Response(JSON.stringify({ error: "Run not found", code: 404 }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      for (const event of run.events) {
        send(event);
      }

      if (run.status !== "running") {
        send({
          type: "done",
          status: run.status,
          summary: run.summary,
          error: run.error,
        });
        controller.close();
        return;
      }

      const unsubscribe = subscribeSyncRun(runId, (event) => {
        send(event);
      });

      const poll = setInterval(() => {
        const current = getSyncRun(runId);
        if (!current || current.status === "running") return;
        send({
          type: "done",
          status: current.status,
          summary: current.summary,
          error: current.error,
        });
        clearInterval(poll);
        unsubscribe?.();
        controller.close();
      }, 500);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
