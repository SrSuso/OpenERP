import { useAuth } from '@/features/auth/useAuth';
import { PricingSettingsPanel } from '@/features/pricing/PricingSettingsPanel';

export function PricingFormulaPage() {
  const { hasPermission } = useAuth();
  return <PricingSettingsPanel canManage={hasPermission('pricing.manage')} />;
}
