// Text only woowtech smart shows, and translations for text upstream hardcodes in
// English. It loads under the `woowtech` key of every language's translations
// (t("woowtech.changelog.empty.title")), so upstream's locale files stay untouched.
// Every language has to carry every key: the type is English's shape.
const ENGLISH = {
  changelog: {
    empty: {
      title: "No release notes yet",
      description: "Release notes will show up here once the first version is released.",
    },
  },
  settings: {
    browserTools: {
      title: "Browser tools",
      warning:
        "Allow agents to access and control woowtech smart browser tabs, including logged-in browser state. Only enable this for agents you trust.",
      updating: "Updating browser tools…",
      enable: "Enable browser tools",
    },
    autoArchiveMerged: {
      title: "Archive merged PR workspaces",
      hint: "Automatically archive clean woowtech smart workspaces after their pull request is merged",
      updateFailed: "Unable to update workspaces",
    },
    terminalAgents: {
      title: "Terminal agents",
      hooks: {
        title: "Enable terminal agent hooks",
        hint: "Get notifications and status from terminal agents. This installs hooks in your agent config files.",
        updateFailed: "Unable to update terminal agent hooks",
      },
    },
    unknownError: "Unknown error",
  },
  sidebar: {
    workspaces: "Workspaces",
  },
};

type WoowtechCopy = typeof ENGLISH;

const WOOWTECH_COPY: Readonly<Record<string, WoowtechCopy>> = {
  en: ENGLISH,
  "zh-TW": {
    changelog: {
      empty: {
        title: "還沒有釋出說明",
        description: "第一個版本釋出後，釋出說明就會顯示在這裡。",
      },
    },
    settings: {
      browserTools: {
        title: "瀏覽器工具",
        warning:
          "允許 Agent 存取並控制渥屋智能的瀏覽器分頁，包括已登入的瀏覽器狀態。只對你信任的 Agent 開啟。",
        updating: "正在更新瀏覽器工具…",
        enable: "啟用瀏覽器工具",
      },
      autoArchiveMerged: {
        title: "封存 PR 已合併的工作區",
        hint: "PR 合併後，自動封存沒有未提交變更的渥屋智能工作區",
        updateFailed: "無法更新工作區設定",
      },
      terminalAgents: {
        title: "終端機 Agent",
        hooks: {
          title: "啟用終端機 Agent hooks",
          hint: "接收終端機 Agent 的通知和狀態。這會在你的 Agent 設定檔中安裝 hooks。",
          updateFailed: "無法更新終端機 Agent hooks",
        },
      },
      unknownError: "未知錯誤",
    },
    sidebar: {
      workspaces: "工作區",
    },
  },
  "zh-CN": {
    changelog: {
      empty: {
        title: "还没有发布说明",
        description: "第一个版本发布后，发布说明就会显示在这里。",
      },
    },
    settings: {
      browserTools: {
        title: "浏览器工具",
        warning:
          "允许 Agent 访问并控制渥屋智能的浏览器标签页，包括已登录的浏览器状态。仅对你信任的 Agent 启用。",
        updating: "正在更新浏览器工具…",
        enable: "启用浏览器工具",
      },
      autoArchiveMerged: {
        title: "归档 PR 已合并的工作区",
        hint: "PR 合并后，自动归档没有未提交变更的渥屋智能工作区",
        updateFailed: "无法更新工作区设置",
      },
      terminalAgents: {
        title: "终端 Agent",
        hooks: {
          title: "启用终端 Agent hooks",
          hint: "接收终端 Agent 的通知和状态。这会在你的 Agent 配置文件中安装 hooks。",
          updateFailed: "无法更新终端 Agent hooks",
        },
      },
      unknownError: "未知错误",
    },
    sidebar: {
      workspaces: "工作区",
    },
  },
  ja: {
    changelog: {
      empty: {
        title: "リリースノートはまだありません",
        description: "最初のバージョンがリリースされると、ここにリリースノートが表示されます。",
      },
    },
    settings: {
      browserTools: {
        title: "ブラウザツール",
        warning:
          "エージェントが woowtech smart のブラウザタブにアクセスして操作できるようにします。ログイン中のブラウザの状態も含まれます。信頼できるエージェントにのみ有効にしてください。",
        updating: "ブラウザツールを更新しています…",
        enable: "ブラウザツールを有効にする",
      },
      autoArchiveMerged: {
        title: "PR がマージされたワークスペースをアーカイブ",
        hint: "プルリクエストがマージされたら、未コミットの変更がない woowtech smart のワークスペースを自動的にアーカイブします",
        updateFailed: "ワークスペースの設定を更新できません",
      },
      terminalAgents: {
        title: "ターミナルエージェント",
        hooks: {
          title: "ターミナルエージェントのフックを有効にする",
          hint: "ターミナルエージェントから通知とステータスを受け取ります。エージェントの設定ファイルにフックがインストールされます。",
          updateFailed: "ターミナルエージェントのフックを更新できません",
        },
      },
      unknownError: "不明なエラー",
    },
    sidebar: {
      workspaces: "ワークスペース",
    },
  },
  ko: {
    changelog: {
      empty: {
        title: "아직 릴리스 노트가 없습니다",
        description: "첫 번째 버전이 출시되면 여기에 릴리스 노트가 표시됩니다.",
      },
    },
    settings: {
      browserTools: {
        title: "브라우저 도구",
        warning:
          "에이전트가 로그인된 브라우저 상태를 포함해 woowtech smart 브라우저 탭에 접근하고 제어할 수 있도록 허용합니다. 신뢰하는 에이전트에만 사용하세요.",
        updating: "브라우저 도구 업데이트 중…",
        enable: "브라우저 도구 사용",
      },
      autoArchiveMerged: {
        title: "PR이 병합된 워크스페이스 보관",
        hint: "풀 리퀘스트가 병합되면 커밋되지 않은 변경 사항이 없는 woowtech smart 워크스페이스를 자동으로 보관합니다",
        updateFailed: "워크스페이스 설정을 업데이트할 수 없습니다",
      },
      terminalAgents: {
        title: "터미널 에이전트",
        hooks: {
          title: "터미널 에이전트 훅 사용",
          hint: "터미널 에이전트의 알림과 상태를 받습니다. 에이전트 설정 파일에 훅이 설치됩니다.",
          updateFailed: "터미널 에이전트 훅을 업데이트할 수 없습니다",
        },
      },
      unknownError: "알 수 없는 오류",
    },
    sidebar: {
      workspaces: "워크스페이스",
    },
  },
  es: {
    changelog: {
      empty: {
        title: "Todavía no hay notas de versión",
        description: "Las notas de versión aparecerán aquí cuando se publique la primera versión.",
      },
    },
    settings: {
      browserTools: {
        title: "Herramientas del navegador",
        warning:
          "Permite que los agentes accedan a las pestañas del navegador de woowtech smart y las controlen, incluido el estado de las sesiones iniciadas. Actívalo solo para agentes de confianza.",
        updating: "Actualizando las herramientas del navegador…",
        enable: "Activar las herramientas del navegador",
      },
      autoArchiveMerged: {
        title: "Archivar espacios de trabajo con la PR fusionada",
        hint: "Archiva automáticamente los espacios de trabajo de woowtech smart sin cambios no confirmados cuando se fusiona su pull request",
        updateFailed: "No se pudieron actualizar los espacios de trabajo",
      },
      terminalAgents: {
        title: "Agentes de terminal",
        hooks: {
          title: "Activar los hooks de los agentes de terminal",
          hint: "Recibe notificaciones y el estado de los agentes de terminal. Esto instala hooks en los archivos de configuración de tus agentes.",
          updateFailed: "No se pudieron actualizar los hooks de los agentes de terminal",
        },
      },
      unknownError: "Error desconocido",
    },
    sidebar: {
      workspaces: "Espacios de trabajo",
    },
  },
  fr: {
    changelog: {
      empty: {
        title: "Aucune note de version pour l'instant",
        description:
          "Les notes de version s'afficheront ici dès la publication de la première version.",
      },
    },
    settings: {
      browserTools: {
        title: "Outils du navigateur",
        warning:
          "Autorise les agents à accéder aux onglets du navigateur de woowtech smart et à les contrôler, y compris l'état des sessions connectées. N'activez cette option que pour des agents de confiance.",
        updating: "Mise à jour des outils du navigateur…",
        enable: "Activer les outils du navigateur",
      },
      autoArchiveMerged: {
        title: "Archiver les espaces de travail dont la PR est fusionnée",
        hint: "Archive automatiquement les espaces de travail woowtech smart sans modifications non validées une fois leur pull request fusionnée",
        updateFailed: "Impossible de mettre à jour les espaces de travail",
      },
      terminalAgents: {
        title: "Agents de terminal",
        hooks: {
          title: "Activer les hooks des agents de terminal",
          hint: "Recevez les notifications et l'état des agents de terminal. Des hooks sont installés dans les fichiers de configuration de vos agents.",
          updateFailed: "Impossible de mettre à jour les hooks des agents de terminal",
        },
      },
      unknownError: "Erreur inconnue",
    },
    sidebar: {
      workspaces: "Espaces de travail",
    },
  },
  "pt-BR": {
    changelog: {
      empty: {
        title: "Ainda não há notas de versão",
        description: "As notas de versão aparecerão aqui quando a primeira versão for lançada.",
      },
    },
    settings: {
      browserTools: {
        title: "Ferramentas do navegador",
        warning:
          "Permite que agentes acessem e controlem as abas do navegador do woowtech smart, incluindo o estado das sessões conectadas. Ative apenas para agentes em que você confia.",
        updating: "Atualizando as ferramentas do navegador…",
        enable: "Ativar as ferramentas do navegador",
      },
      autoArchiveMerged: {
        title: "Arquivar espaços de trabalho com PR mesclado",
        hint: "Arquiva automaticamente os espaços de trabalho do woowtech smart sem alterações pendentes depois que o pull request deles é mesclado",
        updateFailed: "Não foi possível atualizar os espaços de trabalho",
      },
      terminalAgents: {
        title: "Agentes de terminal",
        hooks: {
          title: "Ativar hooks dos agentes de terminal",
          hint: "Receba notificações e o status dos agentes de terminal. Isso instala hooks nos arquivos de configuração dos seus agentes.",
          updateFailed: "Não foi possível atualizar os hooks dos agentes de terminal",
        },
      },
      unknownError: "Erro desconhecido",
    },
    sidebar: {
      workspaces: "Espaços de trabalho",
    },
  },
  ru: {
    changelog: {
      empty: {
        title: "Заметок о выпуске пока нет",
        description: "Заметки о выпуске появятся здесь после выхода первой версии.",
      },
    },
    settings: {
      browserTools: {
        title: "Инструменты браузера",
        warning:
          "Разрешает агентам доступ к вкладкам браузера woowtech smart и управление ими, включая состояние входа в аккаунты. Включайте только для агентов, которым доверяете.",
        updating: "Обновление инструментов браузера…",
        enable: "Включить инструменты браузера",
      },
      autoArchiveMerged: {
        title: "Архивировать рабочие пространства с объединёнными PR",
        hint: "Автоматически архивировать рабочие пространства woowtech smart без незафиксированных изменений после объединения их pull request",
        updateFailed: "Не удалось обновить рабочие пространства",
      },
      terminalAgents: {
        title: "Агенты в терминале",
        hooks: {
          title: "Включить хуки агентов в терминале",
          hint: "Получайте уведомления и статус от агентов в терминале. В конфигурационные файлы агентов будут установлены хуки.",
          updateFailed: "Не удалось обновить хуки агентов в терминале",
        },
      },
      unknownError: "Неизвестная ошибка",
    },
    sidebar: {
      workspaces: "Рабочие пространства",
    },
  },
  ar: {
    changelog: {
      empty: {
        title: "لا توجد ملاحظات إصدار بعد",
        description: "ستظهر ملاحظات الإصدار هنا بعد صدور النسخة الأولى.",
      },
    },
    settings: {
      browserTools: {
        title: "أدوات المتصفح",
        warning:
          "يسمح للوكلاء بالوصول إلى علامات تبويب متصفح woowtech smart والتحكم فيها، بما في ذلك حالة تسجيل الدخول في المتصفح. فعّل هذا فقط للوكلاء الذين تثق بهم.",
        updating: "جارٍ تحديث أدوات المتصفح…",
        enable: "تفعيل أدوات المتصفح",
      },
      autoArchiveMerged: {
        title: "أرشفة مساحات العمل بعد دمج طلب السحب",
        hint: "أرشفة مساحات عمل woowtech smart التي لا تحتوي على تغييرات غير ملتزم بها تلقائيًا بعد دمج طلب السحب الخاص بها",
        updateFailed: "تعذّر تحديث مساحات العمل",
      },
      terminalAgents: {
        title: "وكلاء الطرفية",
        hooks: {
          title: "تفعيل خطافات وكلاء الطرفية",
          hint: "احصل على الإشعارات والحالة من وكلاء الطرفية. يؤدي هذا إلى تثبيت خطافات في ملفات إعدادات الوكلاء.",
          updateFailed: "تعذّر تحديث خطافات وكلاء الطرفية",
        },
      },
      unknownError: "خطأ غير معروف",
    },
    sidebar: {
      workspaces: "مساحات العمل",
    },
  },
};

/** woowtech smart's own text in `language`. A language upstream adds later reads English. */
export function woowtechCopyFor(language: string): WoowtechCopy {
  return WOOWTECH_COPY[language] ?? ENGLISH;
}
