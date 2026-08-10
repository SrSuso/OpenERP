import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  testSmtpSettings,
  type SmtpTestPayload,
  type SystemSettings,
  type SystemSettingsUpdate,
} from '@/features/settings/api';
import { ApiError } from '@/lib/api';

const fieldsSchema = z.object({
  smtp_host: z.string().min(1, 'Introduce un host.').max(255),
  smtp_port: z
    .string()
    .regex(/^\d+$/, 'Introduce un puerto numérico.')
    .refine((value) => Number(value) >= 1 && Number(value) <= 65535, 'El puerto debe estar entre 1 y 65535.'),
  smtp_use_tls: z.boolean(),
  smtp_username: z.string().max(255),
  smtp_password: z.string().max(255),
  smtp_from_email: z.string().min(1, 'Introduce un remitente.').max(255),
  notification_recipient_email: z.string().max(255),
});

type FieldsValues = z.infer<typeof fieldsSchema>;

interface SmtpSettingsFormProps {
  defaults: SystemSettings;
  onSubmit: (payload: SystemSettingsUpdate) => void;
  isPending: boolean;
  submitError: string | null;
}

/** El formulario siempre reenvía su valor actual completo (igual que
 * `TemplateFieldsForm` en modo "revisar") — salvo la contraseña, que el
 * backend sólo toca si se manda la clave (`app.settings.service`): en
 * blanco significa "no la cambies". */
export function SmtpSettingsForm({
  defaults,
  onSubmit,
  isPending,
  submitError,
}: SmtpSettingsFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FieldsValues>({
    resolver: zodResolver(fieldsSchema),
    defaultValues: {
      smtp_host: defaults.smtp_host,
      smtp_port: String(defaults.smtp_port),
      smtp_use_tls: defaults.smtp_use_tls,
      smtp_username: defaults.smtp_username ?? '',
      smtp_password: '',
      smtp_from_email: defaults.smtp_from_email,
      notification_recipient_email: defaults.notification_recipient_email ?? '',
    },
  });

  const submit = handleSubmit((values) => {
    const payload: SystemSettingsUpdate = {
      smtp_host: values.smtp_host,
      smtp_port: Number(values.smtp_port),
      smtp_use_tls: values.smtp_use_tls,
      smtp_username: values.smtp_username,
      smtp_from_email: values.smtp_from_email,
      notification_recipient_email: values.notification_recipient_email,
    };
    if (values.smtp_password) payload.smtp_password = values.smtp_password;
    onSubmit(payload);
  });

  // --- probar configuración: usa lo que hay ahora mismo en el formulario,
  // se haya guardado o no --------------------------------------------------
  const [testEmail, setTestEmail] = useState('');
  const [testState, setTestState] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const sendTest = async () => {
    setTestState('sending');
    setTestMessage(null);
    const values = watch();
    const payload: SmtpTestPayload = {
      to_email: testEmail,
      smtp_host: values.smtp_host,
      smtp_port: /^\d+$/.test(values.smtp_port) ? Number(values.smtp_port) : undefined,
      smtp_use_tls: values.smtp_use_tls,
      smtp_username: values.smtp_username,
      smtp_from_email: values.smtp_from_email,
    };
    if (values.smtp_password) payload.smtp_password = values.smtp_password;
    try {
      await testSmtpSettings(payload);
      setTestState('ok');
    } catch (err) {
      setTestState('error');
      setTestMessage(
        err instanceof ApiError ? err.message : 'No se ha podido enviar el correo de prueba.',
      );
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Servidor de correo (SMTP)</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-600">
          Host
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('smtp_host')}
          />
          {errors.smtp_host && <p className="mt-1 text-sm text-red-600">{errors.smtp_host.message}</p>}
        </label>

        <label className="text-sm text-slate-600">
          Puerto
          <input
            type="text"
            inputMode="numeric"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('smtp_port')}
          />
          {errors.smtp_port && <p className="mt-1 text-sm text-red-600">{errors.smtp_port.message}</p>}
        </label>

        <label className="text-sm text-slate-600">
          Usuario (opcional)
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('smtp_username')}
          />
        </label>

        <label className="text-sm text-slate-600">
          Contraseña
          {defaults.smtp_password_set && (
            <span className="ml-1 text-xs text-slate-400">
              (guardada — déjala en blanco para no cambiarla)
            </span>
          )}
          <input
            type="password"
            autoComplete="new-password"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('smtp_password')}
          />
        </label>

        <label className="text-sm text-slate-600">
          Remitente (De:)
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('smtp_from_email')}
          />
          {errors.smtp_from_email && (
            <p className="mt-1 text-sm text-red-600">{errors.smtp_from_email.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Avisos de incidencias a (opcional)
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('notification_recipient_email')}
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
          <input type="checkbox" {...register('smtp_use_tls')} />
          Usar TLS (STARTTLS)
        </label>
      </div>

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      <div className="mt-6 border-t border-slate-200 pt-4">
        <p className="mb-2 text-sm font-semibold text-slate-700">Probar configuración</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm text-slate-600">
            Enviar correo de prueba a
            <input
              type="text"
              value={testEmail}
              onChange={(event) => setTestEmail(event.target.value)}
              className="mt-1 block w-64 rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={!testEmail || testState === 'sending'}
            onClick={() => void sendTest()}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            {testState === 'sending' ? 'Enviando…' : 'Enviar correo de prueba'}
          </button>
        </div>
        {testState === 'ok' && <p className="mt-2 text-sm text-green-700">Correo de prueba enviado.</p>}
        {testState === 'error' && <p className="mt-2 text-sm text-red-600">{testMessage}</p>}
      </div>
    </form>
  );
}
