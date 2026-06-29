import { z } from "zod";

export const crmFormSchema = z.object({
  embed_code: z.string().min(1).default("<form></form>"),
  label: z.string().optional(),
});

export type CrmFormProps = z.infer<typeof crmFormSchema>;
