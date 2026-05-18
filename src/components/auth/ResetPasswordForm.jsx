import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { resetPasswordSchema } from "@my-app/shared";
import { Input } from "../ui/Input.jsx";
import { Button } from "../ui/Button.jsx";
import { useToast } from "../ui/Toast.jsx";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ROUTES } from "../../config/routes.js";
import api from "../../config/api.js";

export function ResetPasswordForm() {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token },
  });

  const onSubmit = async (data) => {
    try {
      await api.post("/auth/reset-password", data);
      addToast({ message: "Password reset. You can now sign in.", type: "success" });
      navigate(ROUTES.LOGIN);
    } catch (err) {
      addToast({
        message: err.response?.data?.error?.message || "Reset failed",
        type: "error",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <input type="hidden" {...register("token")} />
      <Input
        label="New Password"
        type="password"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Reset password
      </Button>
    </form>
  );
}
