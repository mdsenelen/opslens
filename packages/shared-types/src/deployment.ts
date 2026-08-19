import { z } from "zod";

export const deploymentStatusSchema = z.enum(["pending", "success", "failed"]);
export type DeploymentStatus = z.infer<typeof deploymentStatusSchema>;

export const deploymentSchema = z.object({
  id: z.uuid(),
  serviceId: z.uuid(),
  environmentId: z.uuid(),
  version: z.string().min(1).max(100),
  status: deploymentStatusSchema,
  deployedAt: z.iso.datetime(),
});
export type Deployment = z.infer<typeof deploymentSchema>;

export const createDeploymentSchema = deploymentSchema.omit({ id: true });
export type CreateDeployment = z.infer<typeof createDeploymentSchema>;
