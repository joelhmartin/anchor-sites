import { useAuth } from "../../hooks/useAuth.js";
import { useAccount } from "../../hooks/useAccount.js";
import { H1, Text } from "../../components/ui/Typography.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { PendingInvitations } from "../../components/account/PendingInvitations.jsx";

export function DashboardPage() {
  const { user } = useAuth();
  const { activeAccount } = useAccount();

  return (
    <div className="space-y-6">
      <div>
        <H1>Welcome, {user?.name}</H1>
        {activeAccount && (
          <Text muted className="mt-1">
            {activeAccount.accountName} &middot; {activeAccount.role}
          </Text>
        )}
      </div>

      <PendingInvitations />

      {!user?.emailVerifiedAt && (
        <Card className="border-yellow-200 bg-yellow-50">
          <Text>Please verify your email address. Check your inbox for a verification link.</Text>
        </Card>
      )}

      <Card>
        <Text muted>
          This is your dashboard. Start building your application features here.
        </Text>
      </Card>
    </div>
  );
}
