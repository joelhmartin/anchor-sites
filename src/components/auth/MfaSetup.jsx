import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { mfaEnableSchema } from "@my-app/shared";
import { Input } from "../ui/Input.jsx";
import { Button } from "../ui/Button.jsx";
import { useToast } from "../ui/Toast.jsx";
import api from "../../config/api.js";

export function MfaSetup({ onComplete }) {
  const { addToast } = useToast();
  const [setupData, setSetupData] = useState(null);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(mfaEnableSchema) });

  const startSetup = async () => {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/mfa/setup");
      setSetupData(data.data);
    } catch {
      addToast({ message: "Failed to start MFA setup.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (formData) => {
    try {
      await api.post("/auth/mfa/enable", formData);
      addToast({ message: "MFA enabled!", type: "success" });
      onComplete?.();
    } catch (err) {
      addToast({
        message: err.response?.data?.error?.message || "Invalid code",
        type: "error",
      });
    }
  };

  if (!setupData) {
    return (
      <Button onClick={startSetup} loading={loading}>
        Set up two-factor authentication
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Scan this code with your authenticator app, then enter the verification code below.
      </p>
      <div className="rounded-lg bg-gray-50 p-4 text-center">
        <code className="text-xs break-all">{setupData.uri}</code>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <Input
          label="Verification Code"
          placeholder="Enter 6-digit code"
          maxLength={6}
          error={errors.code?.message}
          {...register("code")}
        />
        <Button type="submit" loading={isSubmitting}>
          Enable MFA
        </Button>
      </form>
    </div>
  );
}
