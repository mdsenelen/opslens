import { z } from "zod";

/**
 * A lookup dimension, not a rich aggregate — see the blueprint's domain
 * model rationale for why Environment stays this thin.
 */
export const environmentNameSchema = z.enum([
  "production",
  "staging",
  "development",
]);
export type EnvironmentName = z.infer<typeof environmentNameSchema>;

export const environmentSchema = z.object({
  id: z.uuid(),
  name: environmentNameSchema,
});
export type Environment = z.infer<typeof environmentSchema>;
