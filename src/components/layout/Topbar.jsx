import { useAuth } from "../../hooks/useAuth.js";
import { Avatar } from "../ui/Avatar.jsx";
import { Dropdown, DropdownItem } from "../ui/Dropdown.jsx";
import { AccountSwitcher } from "../account/AccountSwitcher.jsx";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "../../config/routes.js";

export function Topbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate(ROUTES.LOGIN);
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <AccountSwitcher />
      <div className="flex items-center gap-4">
        <Dropdown
          align="right"
          trigger={
            <button className="flex items-center gap-2 rounded-lg p-1 hover:bg-gray-50">
              <Avatar src={user?.avatarUrl} name={user?.name} size="sm" />
              <span className="text-sm font-medium text-gray-700">{user?.name}</span>
            </button>
          }
        >
          <DropdownItem onClick={() => navigate(ROUTES.SETTINGS)}>Settings</DropdownItem>
          <DropdownItem onClick={handleLogout}>Log out</DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}
