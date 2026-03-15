
import { createGatewayProvider } from "@ai-sdk/gateway";
import { generateText } from "ai";
import type { Plugin } from "vite";

export function analyzeApiPlugin(): Plugin {
  return {
    name: "analyze-api",
    configureServer(server) {
      server.middlewares.use("/api/analyze", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const { image } = body as { image: string };

        if (!image) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Missing image field" }));
          return;
        }

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "ANTHROPIC_API_KEY not set in .env" }));
          return;
        }

        try {
          const base64 = image.replace(/^data:image\/\w+;base64,/, "");

          const gw = createGatewayProvider({ apiKey });
          const model = gw("anthropic/claude-sonnet-4-20250514");

          const result = await generateText({
            model,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    image: base64,
                  },
                  {
                    type: "text",
                    text: "You are analyzing a screenshot from an immersive 3D room viewer (Gaussian splat rendering). Describe what you see in the scene — identify furniture, objects, room layout, lighting, and style. Be specific and concise (3-5 sentences). If you notice anything interesting about the composition or perspective, mention it.",
                  },
                ],
              },
            ],
          });

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ analysis: result.text }));
        } catch (err: any) {
          console.error("[Analyze API] Error:", err.message ?? err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message ?? "LLM call failed" }));
        }
      });
    },
  };
}
