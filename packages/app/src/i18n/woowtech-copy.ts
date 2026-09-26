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
  pairing: {
    relayOff: {
      hint: "Devices paired through the relay can't connect while it's off.",
      action: "Turn off relay",
      pending: "Turning off…",
    },
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
    pairing: {
      relayOff: {
        hint: "停用後，透過中繼配對的裝置就無法連線。",
        action: "停用中繼",
        pending: "正在停用…",
      },
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
    pairing: {
      relayOff: {
        hint: "停用后，通过中继配对的设备将无法连接。",
        action: "停用中继",
        pending: "正在停用…",
      },
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
    pairing: {
      relayOff: {
        hint: "無効にすると、リレー経由でペアリングしたデバイスは接続できなくなります。",
        action: "リレーを無効にする",
        pending: "無効にしています…",
      },
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
    pairing: {
      relayOff: {
        hint: "비활성화하면 릴레이로 페어링한 기기가 연결할 수 없습니다.",
        action: "릴레이 비활성화",
        pending: "비활성화하는 중…",
      },
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
    pairing: {
      relayOff: {
        hint: "Mientras el relé esté deshabilitado, los dispositivos emparejados a través de él no podrán conectarse.",
        action: "Deshabilitar relé",
        pending: "Deshabilitando…",
      },
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
    pairing: {
      relayOff: {
        hint: "Tant que le relais est désactivé, les appareils appairés par son intermédiaire ne peuvent pas se connecter.",
        action: "Désactiver le relais",
        pending: "Désactivation…",
      },
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
    pairing: {
      relayOff: {
        hint: "Enquanto o relay estiver desativado, os dispositivos pareados por ele não conseguem se conectar.",
        action: "Desativar relay",
        pending: "Desativando…",
      },
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
    pairing: {
      relayOff: {
        hint: "Пока ретранслятор отключён, устройства, сопряжённые через него, не смогут подключиться.",
        action: "Отключить ретранслятор",
        pending: "Отключение…",
      },
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
    pairing: {
      relayOff: {
        hint: "أثناء تعطيل التتابع، لا يمكن للأجهزة المقترنة عبره الاتصال.",
        action: "تعطيل التتابع",
        pending: "جارٍ التعطيل…",
      },
    },
  },
};

// These newly migrated surfaces intentionally fall back to English outside Chinese.
const ADD_PROJECT_ENGLISH = {
  title: "Add project",
  searchDirectory: "Search for directory",
  searchDirectoryDescription: "Find a directory on {{host}}",
  cloneGithub: "Clone from GitHub",
  cloneGithubDescription: "Search projects available to your GitHub account",
  githubManualHint: "Enter a GitHub URL or owner/repo",
  newDirectory: "New directory",
  newDirectoryDescription: "Create an empty directory on {{host}}",
  directoryPlaceholder: "Search directories or enter a path...",
  noMatches: "No matching options",
  browse: "Browse",
  browseDescription: "Choose or create a directory in Finder",
  chooseHost: "Choose host",
  chooseDestination: "Choose destination",
  chooseParent: "Choose parent directory",
  nameDirectory: "Name directory",
  directoryName: "Directory name",
  noConnectedHosts: "No connected hosts",
  adding: "Adding project...",
  cloning: "Cloning project...",
  creatingDirectory: "Creating directory...",
  directorySearchFailed: "Unable to search directories",
  githubSearchFailed: "Unable to search GitHub repositories",
  githubSearchUnavailable: "GitHub search is unavailable",
  upgradeForCreate: "Update this host to create directories",
  upgradeForClone: "Update this host to clone GitHub repositories",
  upgradeForAdd: "Update the host to use Add Project.",
  useParent: "Use this parent",
  alreadyExists: "Already exists",
  parentDescription: "Parent directory: {{path}}",
  cloneUrl: "Clone this repository URL",
  cloneProtocol: "Clone owner/repo via {{protocol}}",
  repositoryProtocol: "{{repository}} via {{protocol}}",
  openPath: "Open this path",
  hostPlaceholder: "Search hosts...",
  githubPlaceholder: "Search or enter a GitHub repository...",
  parentPlaceholder: "Search parent directories or enter a path...",
  hostUnavailable: "Host is unavailable",
  directoryNotFound: "Directory not found",
  addFailed: "Unable to add project",
  browseFailed: "Unable to browse for a directory",
  cloneFailed: "Unable to clone repository",
  enterDirectoryName: "Enter a directory name",
  createFailed: "Unable to create directory",
  accessibilityPage: "Add project: {{page}}",
  navigate: "Navigate",
  select: "Select",
};

const ADD_PROJECT_ZH_TW: typeof ADD_PROJECT_ENGLISH = {
  title: "新增專案",
  searchDirectory: "搜尋資料夾",
  searchDirectoryDescription: "在 {{host}} 上尋找資料夾",
  cloneGithub: "從 GitHub 複製專案",
  cloneGithubDescription: "搜尋你的 GitHub 帳號可存取的專案",
  githubManualHint: "輸入 GitHub 網址或 owner/repo",
  newDirectory: "新增資料夾",
  newDirectoryDescription: "在 {{host}} 上建立空白資料夾",
  directoryPlaceholder: "搜尋資料夾或輸入路徑…",
  noMatches: "找不到符合的項目",
  browse: "瀏覽",
  browseDescription: "在 Finder 中選擇或建立資料夾",
  chooseHost: "選擇主機",
  chooseDestination: "選擇存放位置",
  chooseParent: "選擇上層資料夾",
  nameDirectory: "命名資料夾",
  directoryName: "資料夾名稱",
  noConnectedHosts: "沒有已連線的主機",
  adding: "正在新增專案…",
  cloning: "正在複製專案…",
  creatingDirectory: "正在建立資料夾…",
  directorySearchFailed: "無法搜尋資料夾",
  githubSearchFailed: "無法搜尋 GitHub 儲存庫",
  githubSearchUnavailable: "無法使用 GitHub 搜尋",
  upgradeForCreate: "請更新此主機以建立資料夾",
  upgradeForClone: "請更新此主機以複製 GitHub 儲存庫",
  upgradeForAdd: "請更新主機以使用新增專案功能",
  useParent: "使用這個上層資料夾",
  alreadyExists: "已存在",
  parentDescription: "上層資料夾：{{path}}",
  cloneUrl: "複製此儲存庫網址的專案",
  cloneProtocol: "透過 {{protocol}} 複製 owner/repo 的專案",
  repositoryProtocol: "{{repository}}（透過 {{protocol}}）",
  openPath: "開啟此路徑",
  hostPlaceholder: "搜尋主機…",
  githubPlaceholder: "搜尋或輸入 GitHub 儲存庫…",
  parentPlaceholder: "搜尋上層資料夾或輸入路徑…",
  hostUnavailable: "主機無法使用",
  directoryNotFound: "找不到資料夾",
  addFailed: "無法新增專案",
  browseFailed: "無法瀏覽資料夾",
  cloneFailed: "無法複製儲存庫",
  enterDirectoryName: "請輸入資料夾名稱",
  createFailed: "無法建立資料夾",
  accessibilityPage: "新增專案：{{page}}",
  navigate: "移動",
  select: "選取",
};

const ADD_PROJECT_ZH_CN: typeof ADD_PROJECT_ENGLISH = {
  title: "添加项目",
  searchDirectory: "搜索目录",
  searchDirectoryDescription: "在 {{host}} 上查找目录",
  cloneGithub: "从 GitHub 克隆项目",
  cloneGithubDescription: "搜索你的 GitHub 账号可访问的项目",
  githubManualHint: "输入 GitHub 网址或 owner/repo",
  newDirectory: "新建目录",
  newDirectoryDescription: "在 {{host}} 上创建空目录",
  directoryPlaceholder: "搜索目录或输入路径…",
  noMatches: "没有匹配的选项",
  browse: "浏览",
  browseDescription: "在 Finder 中选择或创建目录",
  chooseHost: "选择主机",
  chooseDestination: "选择目标位置",
  chooseParent: "选择父目录",
  nameDirectory: "命名目录",
  directoryName: "目录名称",
  noConnectedHosts: "没有已连接的主机",
  adding: "正在添加项目…",
  cloning: "正在克隆项目…",
  creatingDirectory: "正在创建目录…",
  directorySearchFailed: "无法搜索目录",
  githubSearchFailed: "无法搜索 GitHub 仓库",
  githubSearchUnavailable: "GitHub 搜索不可用",
  upgradeForCreate: "请更新此主机以创建目录",
  upgradeForClone: "请更新此主机以克隆 GitHub 仓库",
  upgradeForAdd: "请更新主机以使用添加项目功能",
  useParent: "使用此父目录",
  alreadyExists: "已存在",
  parentDescription: "父目录：{{path}}",
  cloneUrl: "克隆此仓库网址的项目",
  cloneProtocol: "通过 {{protocol}} 克隆 owner/repo 的项目",
  repositoryProtocol: "{{repository}}（通过 {{protocol}}）",
  openPath: "打开此路径",
  hostPlaceholder: "搜索主机…",
  githubPlaceholder: "搜索或输入 GitHub 仓库…",
  parentPlaceholder: "搜索父目录或输入路径…",
  hostUnavailable: "主机不可用",
  directoryNotFound: "找不到目录",
  addFailed: "无法添加项目",
  browseFailed: "无法浏览目录",
  cloneFailed: "无法克隆仓库",
  enterDirectoryName: "请输入目录名称",
  createFailed: "无法创建目录",
  accessibilityPage: "添加项目：{{page}}",
  navigate: "导航",
  select: "选择",
};

const ADD_PROJECT_COPY: Readonly<Record<string, typeof ADD_PROJECT_ENGLISH>> = {
  "zh-TW": ADD_PROJECT_ZH_TW,
  "zh-CN": ADD_PROJECT_ZH_CN,
};

const HOST_PICKER_ENGLISH = {
  add: "Add host",
  all: "All hosts",
  enableBuiltInDaemon: "Enable built-in daemon",
  title: "Host",
  search: "Search hosts",
  local: "Local",
  openSettings: "Open {{host}} settings",
  filterTitle: "Filter by host",
  filter: "Filter: {{host}}",
};

const HOST_PICKER_ZH_TW: typeof HOST_PICKER_ENGLISH = {
  add: "新增主機",
  all: "所有主機",
  enableBuiltInDaemon: "啟用內建 Daemon",
  title: "主機",
  search: "搜尋主機",
  local: "本機",
  openSettings: "開啟 {{host}} 的設定",
  filterTitle: "依主機篩選",
  filter: "篩選：{{host}}",
};

const HOST_PICKER_ZH_CN: typeof HOST_PICKER_ENGLISH = {
  add: "添加主机",
  all: "所有主机",
  enableBuiltInDaemon: "启用内置 Daemon",
  title: "主机",
  search: "搜索主机",
  local: "本地",
  openSettings: "打开 {{host}} 的设置",
  filterTitle: "按主机筛选",
  filter: "筛选：{{host}}",
};

const HOST_PICKER_COPY: Readonly<Record<string, typeof HOST_PICKER_ENGLISH>> = {
  "zh-TW": HOST_PICKER_ZH_TW,
  "zh-CN": HOST_PICKER_ZH_CN,
};

const DESKTOP_NOTIFICATIONS_ENGLISH = {
  supported: "Notifications are supported; system permission has not been confirmed.",
  unknown: "System notification permission could not be checked.",
  testHint: "Try a notification to check delivery. System permission is not confirmed.",
  send: "Test notification",
  successTitle: "Notification displayed",
  successDescription:
    "The system reported display, but this does not confirm that you saw a banner.",
  failedTitle: "Notification failed",
  unconfirmedTitle: "Unable to confirm notification display",
  unconfirmed:
    "Notification display could not be confirmed. Check System Settings → Notifications. Unsigned test builds may be unable to display notifications.",
  failed:
    "Notification display failed. Check System Settings → Notifications. Unsigned test builds may be unable to display notifications.",
};

const DESKTOP_NOTIFICATIONS_ZH_TW: typeof DESKTOP_NOTIFICATIONS_ENGLISH = {
  supported: "系統支援通知，但尚未確認系統授權狀態。",
  unknown: "無法確認系統通知的授權狀態。",
  testHint: "可傳送測試通知來檢查是否顯示；目前尚未確認系統授權。",
  send: "傳送測試通知",
  successTitle: "通知已顯示",
  successDescription: "系統已回報顯示通知，但不代表你一定看到了通知橫幅。",
  failedTitle: "通知顯示失敗",
  unconfirmedTitle: "無法確認通知是否顯示",
  unconfirmed:
    "無法確認通知是否顯示。請到「系統設定 → 通知」檢查；未簽章的測試版可能無法顯示通知。",
  failed: "通知顯示失敗。請到「系統設定 → 通知」檢查；未簽章的測試版可能無法顯示通知。",
};

const AGENT_NOTIFICATION_TITLES_ENGLISH = {
  finished: "Agent finished",
  permission: "Agent needs permission",
  attention: "Agent needs attention",
};

const AGENT_NOTIFICATION_TITLES_ZH_TW: typeof AGENT_NOTIFICATION_TITLES_ENGLISH = {
  finished: "工作完成了",
  permission: "需要你的授權",
  attention: "需要你的注意",
};

/** woowtech smart's own text in `language`. A language upstream adds later reads English. */
export function woowtechCopyFor(language: string) {
  return {
    ...(WOOWTECH_COPY[language] ?? ENGLISH),
    addProject: ADD_PROJECT_COPY[language] ?? ADD_PROJECT_ENGLISH,
    hostPicker: HOST_PICKER_COPY[language] ?? HOST_PICKER_ENGLISH,
    desktopNotifications:
      language === "zh-TW" ? DESKTOP_NOTIFICATIONS_ZH_TW : DESKTOP_NOTIFICATIONS_ENGLISH,
    agentNotificationTitles:
      language === "zh-TW" ? AGENT_NOTIFICATION_TITLES_ZH_TW : AGENT_NOTIFICATION_TITLES_ENGLISH,
  };
}
