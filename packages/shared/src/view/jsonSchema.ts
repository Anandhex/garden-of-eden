/** The view protocol as JSON Schema files (G5): what `npm run schema` writes, and what the test compares. */
import { z } from "zod";
import { FrameSchema, IntentSchema, PROTOCOL_VERSION, ServerMsgSchema, UiModelSchema } from "./schema.js";

const file = (title: string, schema: z.ZodType) => `${JSON.stringify({ title, version: PROTOCOL_VERSION, ...z.toJSONSchema(schema, { unrepresentable: "any", reused: "ref" }) }, null, 2)}\n`;

export function schemaFiles(): Record<string, string> {
  return {
    "intent.json": file("Intent (adapter to server)", IntentSchema),
    "server-msg.json": file("ServerMsg (server to adapter)", ServerMsgSchema),
    "frame.json": file("Frame", FrameSchema),
    "ui-model.json": file("UiModel", UiModelSchema),
  };
}
