import { z } from "zod";

export const serviceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug must be kebab-case"),
  description: z.string().max(2000).nullable(),
  createdAt: z.iso.datetime(),
});
export type Service = z.infer<typeof serviceSchema>;

export const createServiceSchema = serviceSchema.omit({
  id: true,
  createdAt: true,
});
export type CreateService = z.infer<typeof createServiceSchema>;
