import { useAuth } from '@/features/auth/useAuth';
import { WarehousesPanel } from '@/features/inventory/WarehousesPanel';

export function InventoryWarehousesPage() {
  const { hasPermission } = useAuth();
  return <WarehousesPanel canManage={hasPermission('inventory.manage')} />;
}
