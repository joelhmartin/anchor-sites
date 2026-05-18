import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateAccountSchema } from "@my-app/shared";
import { Input } from "../ui/Input.jsx";
import { Button } from "../ui/Button.jsx";
import { Card } from "../ui/Card.jsx";
import { useToast } from "../ui/Toast.jsx";
import { useAccount } from "../../hooks/useAccount.js";
import api from "../../config/api.js";

export function AccountSettings() {
  const { activeAccount, fetchAccounts } = useAccount();
  const { addToast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(updateAccountSchema),
    defaultValues: {
      name: activeAccount?.accountName || "",
    },
  });

  const onSubmit = async (data) => {
    try {
      await api.patch(`/accounts/${activeAccount.accountId}`, data);
      await fetchAccounts();
      addToast({ message: "Account updated.", type: "success" });
    } catch (err) {
      addToast({
        message: err.response?.data?.error?.message || "Update failed.",
        type: "error",
      });
    }
  };

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold">Account Settings</h3>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label="Account Name"
          error={errors.name?.message}
          {...register("name")}
        />
        <Button type="submit" loading={isSubmitting}>
          Save Changes
        </Button>
      </form>
    </Card>
  );
}
