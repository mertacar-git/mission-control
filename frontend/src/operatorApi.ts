export const operatorBase = location.protocol === 'https:' && location.port === '8772'
  ? '/api/v1/operators' : 'https://127.0.0.1:8772/api/v1/operators';

export async function operatorError(response: Response): Promise<string> {
  const messages: Record<string, string> = {
    session_expired: 'Oturum sona erdi. Yeniden giriş yapın.',
    permission_denied: 'Bu işlem için yönetici yetkisi gerekir.',
    registry_unavailable: 'Cihaz siciline ulaşılamıyor. Sicil servisini kontrol edin.',
    registry_tls_invalid: 'Sicil sertifikası doğrulanamadı. Güvenilen CA ve sertifika süresini kontrol edin.',
    registry_identity_rejected: 'Merkezin sicil kimliği reddedildi. Sertifika kaydını ve iptal durumunu kontrol edin.',
    duplicate_device: 'Bu seri numarası zaten kayıtlı. Mevcut cihaz değiştirilmedi.',
  };
  const body = await response.json().catch(() => ({}));
  return messages[body.code] ?? (response.status === 429 ? 'İşlem sınırına ulaşıldı. Daha sonra tekrar deneyin.' : 'İstek tamamlanamadı. Sonucu kontrol edin.');
}
