// Help copy for WoowTech's support channels. Upstream's keys still carry the
// old channel names: the help menu's Discord item opens WoowTech's website and
// its GitHub item writes to support. Keyed by dotted translation key.
type SupportCopy = Readonly<Record<string, string>>;

const ENGLISH: SupportCopy = {
  "sidebar.help.discord": "Official website",
  "sidebar.help.github": "Email support",
  "startup.errorDescription":
    "The local server failed to start. If this keeps happening, please email support and include the logs below.",
};

const SUPPORT_COPY: Readonly<Record<string, SupportCopy>> = {
  en: ENGLISH,
  "zh-TW": {
    "sidebar.help.discord": "官方網站",
    "sidebar.help.github": "寄信給客服",
    "startup.errorDescription": "本機伺服器啟動失敗。如果持續發生，請寄信給客服並附上下方記錄。",
  },
  "zh-CN": {
    "sidebar.help.discord": "官方网站",
    "sidebar.help.github": "发邮件给客服",
    "startup.errorDescription": "本地服务器启动失败。如果持续发生，请发邮件给客服并附上下方日志。",
  },
  ja: {
    "sidebar.help.discord": "公式サイト",
    "sidebar.help.github": "サポートにメール",
    "startup.errorDescription":
      "ローカルサーバーの起動に失敗しました。この問題が続く場合は、以下のログを添えてサポートにメールしてください。",
  },
  ko: {
    "sidebar.help.discord": "공식 웹사이트",
    "sidebar.help.github": "고객 지원에 이메일 보내기",
    "startup.errorDescription":
      "로컬 서버를 시작하지 못했습니다. 이 문제가 계속되면 아래 로그를 포함하여 고객 지원에 이메일을 보내 주세요.",
  },
  es: {
    "sidebar.help.discord": "Sitio web oficial",
    "sidebar.help.github": "Escribir a soporte",
    "startup.errorDescription":
      "El servidor local no pudo iniciarse. Si esto continúa sucediendo, escriba a soporte e incluya los registros a continuación.",
  },
  fr: {
    "sidebar.help.discord": "Site officiel",
    "sidebar.help.github": "Écrire au support",
    "startup.errorDescription":
      "Le serveur local n'a pas pu démarrer. Si cela continue, veuillez écrire au support et inclure les journaux ci-dessous.",
  },
  "pt-BR": {
    "sidebar.help.discord": "Site oficial",
    "sidebar.help.github": "Enviar e-mail ao suporte",
    "startup.errorDescription":
      "O servidor local falhou ao iniciar. Se isso continuar acontecendo, envie um e-mail ao suporte e inclua os logs abaixo.",
  },
  ru: {
    "sidebar.help.discord": "Официальный сайт",
    "sidebar.help.github": "Написать в поддержку",
    "startup.errorDescription":
      "Не удалось запустить локальный сервер. Если ошибка повторится, напишите в поддержку и приложите приведённые ниже журналы.",
  },
  ar: {
    "sidebar.help.discord": "الموقع الرسمي",
    "sidebar.help.github": "مراسلة الدعم عبر البريد",
    "startup.errorDescription":
      "فشل الخادم المحلي في البدء. إذا استمر حدوث ذلك، فيرجى مراسلة الدعم عبر البريد الإلكتروني وتضمين السجلات أدناه.",
  },
};

/** The help copy for `language`. A language upstream adds later reads the English copy. */
export function supportCopyFor(language: string): SupportCopy {
  return SUPPORT_COPY[language] ?? ENGLISH;
}
