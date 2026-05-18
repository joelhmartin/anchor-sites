import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createInviteSchema } from "@my-app/shared";
import { ROLES } from "@my-app/shared";
import { Modal } from "../ui/Modal.jsx";
import { Input } from "../ui/Input.jsx";
import { Button } from "../ui/Button.jsx";
import { useToast } from "../ui/Toast.jsx";
import { useAccount } from "../../hooks/useAccount.js";
import api from "../../config/api.js";

export function InviteMemberModal({ open, onClose }) {
  const { activeAccount } = useAccount();
  const { addToast } = useToast();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createInviteSchema),
    defaultValues: { role: "member" },
  });

  const onSubmit = async (data) => {
    try {
      await api.post(`/accounts/${activeAccount.accountId}/members/invite`, data);
      addToast({ message: `Invitation sent to ${data.email}`, type: "success" });
      reset();
      onClose();
    } catch (err) {
      addToast({
        message: err.response?.data?.error?.message || "Failed to send invitation.",
        type: "error",
      });
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite Member">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label="Email"
          type="email"
          error={errors.email?.message}
          {...register("email")}
        />
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Role</label>
          <select
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            {...register("role")}
          >
            {ROLES.filter((r) => r.slug !== "owner").map((role) => (
              <option key={role.slug} value={role.slug}>
                {role.label}
              </option>
            ))}
          </select>
          {errors.role && <p className="text-sm text-red-600">{errors.role.message}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Send Invitation
          </Button>
        </div>
      </form>
    </Modal>
  );
}
