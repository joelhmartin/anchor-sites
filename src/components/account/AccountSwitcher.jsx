import { useAccount } from "../../hooks/useAccount.js";
import { Dropdown, DropdownItem } from "../ui/Dropdown.jsx";
import { Badge } from "../ui/Badge.jsx";

export function AccountSwitcher() {
  const { accounts, activeAccount, switchAccount } = useAccount();

  if (!activeAccount) return null;

  return (
    <Dropdown
      trigger={
        <button className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          {activeAccount.accountName}
          <Badge color="blue">{activeAccount.role}</Badge>
        </button>
      }
    >
      {accounts.map((account) => (
        <DropdownItem
          key={account.accountId}
          onClick={() => switchAccount(account.accountId)}
        >
          <div className="flex items-center justify-between gap-4">
            <span>{account.accountName}</span>
            <Badge color="gray">{account.role}</Badge>
          </div>
        </DropdownItem>
      ))}
    </Dropdown>
  );
}
