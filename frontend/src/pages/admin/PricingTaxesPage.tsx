import { useAuth } from '@/features/auth/useAuth';
import { TaxesPanel } from '@/features/pricing/TaxesPanel';

export function PricingTaxesPage() {
  const { hasPermission } = useAuth();
  return <TaxesPanel canManage={hasPermission('pricing.manage')} />;
}
