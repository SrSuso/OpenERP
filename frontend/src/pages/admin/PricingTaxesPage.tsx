import { useAuth } from '@/features/auth/AuthContext';
import { TaxesPanel } from '@/features/pricing/TaxesPanel';

export function PricingTaxesPage() {
  const { hasPermission } = useAuth();
  return <TaxesPanel canManage={hasPermission('pricing.manage')} />;
}
