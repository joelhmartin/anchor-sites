import { useAccount } from "../hooks/useAccount.js";
import { Spinner } from "../components/ui/Spinner.jsx";

export function RequireAccount({ children }) {
  const { activeAccount, isLoading } = useAccount();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!activeAccount) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-gray-500">No account selected. Please create or join an account.</p>
      </div>
    );
  }

  return children;
}
