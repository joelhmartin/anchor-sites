import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { mfaVerifySchema } from "@my-app/shared";
import { Input } from "../ui/Input.jsx";
import { Button } from "../ui/Button.jsx";
import { useAuth } from "../../hooks/useAuth.js";
import { useToast } from "../ui/Toast.jsx";

export function MfaChallenge({ mfaToken }) {
  const { verifyMfa } = useAuth();
  const { addToast } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(mfaVerifySchema),
    defaultValues: { mfaToken },
  });

  const onSubmit = async (data) => {
    try {
      await verifyMfa(data);
    } catch (err) {
      addToast({
        message: err.response?.data?.error?.message || "Invalid code",
        type: "error",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <input type="hidden" {...register("mfaToken")} />
      <Input
        label="Authentication Code"
        placeholder="Enter 6-digit code"
        autoComplete="one-time-code"
        maxLength={6}
        error={errors.code?.message}
        {...register("code")}
      />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Verify
      </Button>
    </form>
  );
}
