import { useAuth } from '@/features/auth/AuthContext';
import { PricingSettingsPanel } from '@/features/pricing/PricingSettingsPanel';

export function PricingFormulaPage() {
  const { hasPermission } = useAuth();
  return <PricingSettingsPanel canManage={hasPermission('pricing.manage')} />;
}
