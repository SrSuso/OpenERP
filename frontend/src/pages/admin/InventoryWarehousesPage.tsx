import { useAuth } from '@/features/auth/AuthContext';
import { WarehousesPanel } from '@/features/inventory/WarehousesPanel';

export function InventoryWarehousesPage() {
  const { hasPermission } = useAuth();
  return <WarehousesPanel canManage={hasPermission('inventory.manage')} />;
}
