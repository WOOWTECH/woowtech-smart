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
    "Check System Settings → Notifications. Unsigned test builds may be unable to display notifications.",
  failed:
    "Check System Settings → Notifications. Unsigned test builds may be unable to display notifications.",
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
  unconfirmed: "請到「系統設定 → 通知」檢查；未簽章的測試版可能無法顯示通知。",
  failed: "請到「系統設定 → 通知」檢查；未簽章的測試版可能無法顯示通知。",
};

const NOTIFICATION_DISPLAY_ENGLISH = {
  title: "Notifications are not showing",
  description:
    "The system did not show a woowtech smart notification. Notifications may be turned off or not allowed yet.",
  sentToPhone: "That notification went to your phone instead.",
  hostTooOld: "This host can't send them to your phone. Update it to the latest woowtech smart.",
  openSettings: "Open notification settings",
};

const NOTIFICATION_DISPLAY_ZH_TW: typeof NOTIFICATION_DISPLAY_ENGLISH = {
  title: "這台電腦沒有顯示通知",
  description: "系統沒有顯示 woowtech smart 的通知，可能是通知被關掉，或還沒按「允許」。",
  sentToPhone: "那則通知已改送到你的手機。",
  hostTooOld: "這台主機無法改送到手機，請把它更新到最新的 woowtech smart。",
  openSettings: "打開通知設定",
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

const METADATA_GENERATION_ENGLISH = {
  projectInfo:
    "woowtech smart currently does not automatically generate workspace titles, branch names, commit messages or PR drafts. Saved project instructions are retained but are not used for automatic generation.",
  description:
    "woowtech smart currently does not automatically generate workspace titles, branch names, commit messages or PR drafts. Saved model preferences are retained but do not enable generation.",
  automaticHint: "Automatic model selection is inactive while generation is disabled.",
  preferredHint: "Saved model preferences are inactive while generation is disabled.",
  fallbackHint: "This preference is retained; no model is called for metadata generation.",
};

const METADATA_GENERATION_ZH_TW: typeof METADATA_GENERATION_ENGLISH = {
  projectInfo:
    "woowtech smart 目前不會自動產生工作區標題、分支名稱、提交訊息或 PR 草稿。已儲存的專案指令會保留，但不會用於自動產生。",
  description:
    "woowtech smart 目前不會自動產生工作區標題、分支名稱、提交訊息或 PR 草稿。已儲存的模型偏好會保留，但不會啟用自動產生。",
  automaticHint: "自動產生已停用，目前不會自動選擇模型。",
  preferredHint: "自動產生已停用，目前不會套用已儲存的模型偏好。",
  fallbackHint: "此偏好會保留；不會呼叫任何模型來產生後設資料。",
};

// Upstream hardcodes the schedules screen, its form and its cadence text in English.
const SCHEDULES_ENGLISH = {
  filters: { active: "Active", ended: "Ended" },
  newSchedule: "New schedule",
  loadFailed: "Unable to load schedules",
  retry: "Try again",
  hostLoadFailed: "{{host}}: Could not load schedules",
  empty: {
    title: "No active schedules",
    description: "Schedules run agents on a cadence.",
    docs: "See docs",
  },
  endedEmpty: "No ended schedules",
  states: {
    active: "Active",
    paused: "Paused",
    expired: "Expired",
    finished: "Finished",
    targetGone: "Target gone",
  },
  meta: {
    created: "Created {{time}}",
    lastRun: "Last run {{time}}",
    neverRun: "Never run",
    nextRun: "Next run {{time}}",
  },
  schedule: {
    untitled: "Untitled schedule",
    edit: "Edit schedule",
    editTitle: "Edit schedule {{title}}",
    delete: "Delete schedule",
    actions: "Schedule actions",
  },
  heartbeat: {
    untitled: "Untitled heartbeat",
    edit: "Edit heartbeat",
    editTitle: "Edit heartbeat {{title}}",
    delete: "Delete heartbeat",
    actions: "Heartbeat actions",
  },
  actions: {
    resume: "Resume schedule",
    resuming: "Resuming...",
    pause: "Pause schedule",
    pausing: "Pausing...",
    runNow: "Run now",
    starting: "Starting...",
    deleting: "Deleting...",
  },
  deleteConfirm: {
    message: 'Delete "{{title}}"? This cannot be undone.',
    confirm: "Delete",
  },
  form: {
    cancel: "Cancel",
    save: "Save changes",
    create: "Create schedule",
    cadenceRequired: "Choose a cron cadence before creating this schedule",
    name: "Name",
    nameLabel: "Schedule name",
    optional: "Optional",
    prompt: "Prompt",
    promptPlaceholder: "What should the agent do each run?",
    maxRuns: "Max runs",
    unlimited: "Unlimited",
    host: "Host",
    selectHost: "Select host",
    noHosts: "No hosts found",
    project: "Project",
    selectProject: "Select project",
    noProjects: "No projects found",
    chooseHostFirst: "Choose a host first.",
    searchProjects: "Search projects...",
    model: "Model",
    thinking: "Thinking",
    selectThinking: "Select thinking",
    noThinking: "No thinking options found",
    mode: "Mode",
    defaultMode: "Default mode",
    noModes: "No modes found",
    noModesForModel: "No modes are available for this model.",
    selectMode: "Select mode",
    archiveOnFinish: "Archive on finish",
    isolation: "Isolation",
    selectIsolation: "Select isolation",
    noIsolation: "No isolation options found",
    local: "Local",
    worktree: "Worktree",
    target: "Target",
    agentUnavailable: "Agent unavailable",
    untitledAgent: "Untitled agent",
  },
  cadence: {
    label: "Cadence",
    select: "Select cadence",
    none: "No cadences found",
    cronLabel: "Cron expression",
    presets: {
      everyMinute: "Every minute",
      everyHour: "Every hour",
      daily9: "Daily 9:00",
      weekdays9: "Weekdays 9:00",
      mondays9: "Mondays 9:00",
      custom: "Custom cron",
    },
    every: {
      minute: "Every 1 minute",
      minutes: "Every {{value}} minutes",
      hour: "Every 1 hour",
      hours: "Every {{value}} hours",
      day: "Every 1 day",
      days: "Every {{value}} days",
    },
    everyMinute: "Every minute",
    everyHour: "Every hour",
    everyHourAt: "Every hour at :{{minute}}",
    at: "{{days}} at {{time}} {{timezone}}",
    days: {
      daily: "Daily",
      weekdays: "Weekdays",
      weekends: "Weekends",
      0: "Sundays",
      1: "Mondays",
      2: "Tuesdays",
      3: "Wednesdays",
      4: "Thursdays",
      5: "Fridays",
      6: "Saturdays",
    },
    enterExpression: "Enter a cron expression",
    wrongFieldCount: "Cron expressions must have 5 fields",
    invalid: "Invalid {{field}} {{problem}}",
    fields: {
      minute: "minute",
      hour: "hour",
      "day-of-month": "day-of-month",
      month: "month",
      "day-of-week": "day-of-week",
    },
    problems: { step: "step", field: "field", range: "range", value: "value" },
  },
  nextRun: {
    soon: "soon",
    minutes: "in {{value}}m",
    hours: "in {{value}}h",
    days: "in {{value}}d",
  },
};

const SCHEDULES_ZH_TW: typeof SCHEDULES_ENGLISH = {
  filters: { active: "進行中", ended: "已結束" },
  newSchedule: "新增排程",
  loadFailed: "無法載入排程",
  retry: "重試",
  hostLoadFailed: "{{host}}：無法載入排程",
  empty: {
    title: "沒有進行中的排程",
    description: "排程會依照設定的頻率執行 Agent。",
    docs: "查看說明文件",
  },
  endedEmpty: "沒有已結束的排程",
  states: {
    active: "進行中",
    paused: "已暫停",
    expired: "已過期",
    finished: "已完成",
    targetGone: "目標已不存在",
  },
  meta: {
    created: "建立：{{time}}",
    lastRun: "上次執行：{{time}}",
    neverRun: "從未執行",
    nextRun: "下次執行：{{time}}",
  },
  schedule: {
    untitled: "未命名排程",
    edit: "編輯排程",
    editTitle: "編輯排程 {{title}}",
    delete: "刪除排程",
    actions: "排程動作",
  },
  heartbeat: {
    untitled: "未命名心跳",
    edit: "編輯心跳",
    editTitle: "編輯心跳 {{title}}",
    delete: "刪除心跳",
    actions: "心跳動作",
  },
  actions: {
    resume: "繼續排程",
    resuming: "正在繼續…",
    pause: "暫停排程",
    pausing: "正在暫停…",
    runNow: "立即執行",
    starting: "正在啟動…",
    deleting: "正在刪除…",
  },
  deleteConfirm: {
    message: "要刪除「{{title}}」嗎？刪除後無法復原。",
    confirm: "刪除",
  },
  form: {
    cancel: "取消",
    save: "儲存變更",
    create: "建立排程",
    cadenceRequired: "建立排程前，請先選擇 cron 頻率",
    name: "名稱",
    nameLabel: "排程名稱",
    optional: "選填",
    prompt: "提示詞",
    promptPlaceholder: "每次執行時，Agent 要做什麼？",
    maxRuns: "執行次數上限",
    unlimited: "不限",
    host: "主機",
    selectHost: "選擇主機",
    noHosts: "找不到主機",
    project: "專案",
    selectProject: "選擇專案",
    noProjects: "找不到專案",
    chooseHostFirst: "請先選擇主機。",
    searchProjects: "搜尋專案…",
    model: "模型",
    thinking: "思考",
    selectThinking: "選擇思考程度",
    noThinking: "找不到思考選項",
    mode: "模式",
    defaultMode: "預設模式",
    noModes: "找不到模式",
    noModesForModel: "這個模型沒有可用的模式。",
    selectMode: "選擇模式",
    archiveOnFinish: "完成後封存",
    isolation: "隔離",
    selectIsolation: "選擇隔離方式",
    noIsolation: "找不到隔離選項",
    local: "本機",
    worktree: "worktree",
    target: "目標",
    agentUnavailable: "無法使用 Agent",
    untitledAgent: "未命名 Agent",
  },
  cadence: {
    label: "頻率",
    select: "選擇頻率",
    none: "找不到頻率",
    cronLabel: "Cron 運算式",
    presets: {
      everyMinute: "每分鐘",
      everyHour: "每小時",
      daily9: "每天 9:00",
      weekdays9: "平日 9:00",
      mondays9: "每週一 9:00",
      custom: "自訂 cron",
    },
    every: {
      minute: "每 1 分鐘",
      minutes: "每 {{value}} 分鐘",
      hour: "每 1 小時",
      hours: "每 {{value}} 小時",
      day: "每 1 天",
      days: "每 {{value}} 天",
    },
    everyMinute: "每分鐘",
    everyHour: "每小時",
    everyHourAt: "每小時的第 {{minute}} 分",
    at: "{{days}} {{time}}（{{timezone}}）",
    days: {
      daily: "每天",
      weekdays: "平日",
      weekends: "週末",
      0: "每週日",
      1: "每週一",
      2: "每週二",
      3: "每週三",
      4: "每週四",
      5: "每週五",
      6: "每週六",
    },
    enterExpression: "請輸入 cron 運算式",
    wrongFieldCount: "Cron 運算式必須有 5 個欄位",
    invalid: "{{field}}的{{problem}}無效",
    fields: {
      minute: "分鐘",
      hour: "小時",
      "day-of-month": "日期",
      month: "月份",
      "day-of-week": "星期",
    },
    problems: { step: "間隔", field: "欄位", range: "範圍", value: "數值" },
  },
  nextRun: {
    soon: "即將開始",
    minutes: "{{value}} 分鐘後",
    hours: "{{value}} 小時後",
    days: "{{value}} 天後",
  },
};

// Relative times and durations, which upstream formats with English units.
const TIME_ENGLISH = {
  dateLocale: "en-US",
  justNow: "just now",
  ago: {
    minutes: "{{value}}m ago",
    hours: "{{value}}h ago",
    days: "{{value}}d ago",
  },
  compact: {
    now: "now",
    minutes: "{{value}}m",
    hours: "{{value}}h",
    days: "{{value}}d",
  },
  duration: {
    seconds: "{{seconds}}s",
    minutes: "{{minutes}}m",
    minutesSeconds: "{{minutes}}m {{seconds}}s",
    hours: "{{hours}}h",
    hoursMinutes: "{{hours}}h {{minutes}}m",
  },
};

const TIME_ZH_TW: typeof TIME_ENGLISH = {
  dateLocale: "zh-TW",
  justNow: "剛剛",
  ago: {
    minutes: "{{value}} 分鐘前",
    hours: "{{value}} 小時前",
    days: "{{value}} 天前",
  },
  compact: {
    now: "剛剛",
    minutes: "{{value}} 分",
    hours: "{{value}} 小時",
    days: "{{value}} 天",
  },
  duration: {
    seconds: "{{seconds}} 秒",
    minutes: "{{minutes}} 分鐘",
    minutesSeconds: "{{minutes}} 分 {{seconds}} 秒",
    hours: "{{hours}} 小時",
    hoursMinutes: "{{hours}} 小時 {{minutes}} 分",
  },
};

const MESSAGE_ENGLISH = {
  workedFor: "Worked for {{duration}}",
  turnEnded: "{{label}}, ended {{time}}",
};

const MESSAGE_ZH_TW: typeof MESSAGE_ENGLISH = {
  workedFor: "工作了 {{duration}}",
  turnEnded: "{{label}}，結束於 {{time}}",
};

// The daemon explains why a workspace cannot be recovered in English; its reason code
// picks the translation. The English matches the daemon's own text.
const WORKSPACE_RECOVERY_ENGLISH = {
  workspace_not_found: "This workspace is no longer known to the host.",
  workspace_not_archived: "This workspace is not archived, but it is unavailable from the host.",
  project_not_found: "The project for this archived workspace no longer exists.",
  workspace_directory_missing:
    "The archived workspace directory no longer exists and cannot be recreated.",
  worktree_branch_missing:
    "The archived worktree has no branch recorded, so it cannot be restored.",
  project_directory_missing:
    "The source repository needed to restore this worktree no longer exists.",
  unsupportedAction: "Update woowtech smart to recover this workspace.",
};

const WORKSPACE_RECOVERY_ZH_TW: typeof WORKSPACE_RECOVERY_ENGLISH = {
  workspace_not_found: "主機上已經沒有這個工作區。",
  workspace_not_archived: "這個工作區沒有封存，但主機目前無法提供。",
  project_not_found: "這個封存工作區所屬的專案已經不存在。",
  workspace_directory_missing: "封存工作區的資料夾已經不存在，無法重新建立。",
  worktree_branch_missing: "這個封存的 worktree 沒有記錄分支，無法恢復。",
  project_directory_missing: "恢復這個 worktree 需要的來源儲存庫已經不存在。",
  unsupportedAction: "請更新渥屋智能，才能恢復這個工作區。",
};

const COMPOSER_ENGLISH = {
  uploadConnectionLost:
    "The file was not uploaded because the connection to the host was lost. Add it again once the host is back.",
};

const COMPOSER_ZH_TW: typeof COMPOSER_ENGLISH = {
  uploadConnectionLost: "與主機的連線中斷，檔案沒有上傳。主機連回來後請再加入一次。",
};

const CLAUDE_SDK_ENGLISH = {
  download:
    "First use of Claude requires downloading a component, but the registry or mirror could not be reached. Send your next message to retry.",
  integrity:
    "The downloaded Claude component failed its integrity check and was not installed. Send your next message to retry.",
  runtime: "Claude component could not be installed or loaded. Send your next message to retry.",
};
const CLAUDE_SDK_ZH_TW: typeof CLAUDE_SDK_ENGLISH = {
  download:
    "首次使用 Claude 需要下載元件，但目前無法連線到 registry 或鏡像站。傳送下一則訊息時會自動重試。",
  integrity: "下載的 Claude 元件未通過完整性檢查，因此沒有安裝。傳送下一則訊息時會自動重試。",
  runtime: "無法安裝或載入 Claude 元件。傳送下一則訊息時會自動重試。",
};

// Claude's login state in the provider list (woowtech/README.md §3). The variable names and the
// command stay as they are typed.
const CLAUDE_AUTH_ENGLISH = {
  needsLogin: "Login required",
  needsLoginHint: "Run claude auth login on the host, or set an API key.",
  subscription: "Signed in with a Claude subscription",
  signedIn: "Signed in",
  apiKey: "Uses an API key (billed per use), not a Claude subscription",
  authToken: "ANTHROPIC_AUTH_TOKEN is set",
  oauthToken: "CLAUDE_CODE_OAUTH_TOKEN is set",
  configured: "Credentials are set",
  unknown: "Login status unknown",
  // Phones hide the status label, so the line under the name and the row's screen reader name
  // carry it.
  hintWithStatus: "{{status}}: {{hint}}",
  rowWithStatus: "{{row}}, {{status}}",
};
const CLAUDE_AUTH_ZH_TW: typeof CLAUDE_AUTH_ENGLISH = {
  needsLogin: "需要登入",
  needsLoginHint: "請在主機上執行 claude auth login，或設定 API key。",
  subscription: "已使用 Claude 訂閱登入",
  signedIn: "已登入",
  apiKey: "使用 API key（按用量計費），不是 Claude 訂閱",
  authToken: "已設定 ANTHROPIC_AUTH_TOKEN",
  oauthToken: "已設定 CLAUDE_CODE_OAUTH_TOKEN",
  configured: "已設定認證資訊",
  unknown: "無法確認登入狀態",
  hintWithStatus: "{{status}}：{{hint}}",
  rowWithStatus: "{{row}}，{{status}}",
};

// Settings > Trademarks and third-party notices (woowtech/README.md §24). The marks' names,
// owners, credits and license texts come from screens/settings/woowtech-third-party-notices.ts and
// stay as their owners write them.
const THIRD_PARTY_NOTICES_ENGLISH = {
  title: "Trademarks and third-party notices",
  statement:
    "woowtech smart is not affiliated with, sponsored or endorsed by the companies or projects listed here. Their names and marks belong to their owners and appear only to identify the agents, services and file types they stand for.",
  sections: {
    trademarks: "Trademarks",
    agents: "Agents",
    agentsInfo:
      "Agents shown with their own icon, as each author publishes it for ACP clients. Other agents show a text badge.",
    forges: "Git forges",
    forgesInfo:
      "Shown next to links that open a forge. GitHub and Codeberg draw in black or white, and GitLab shows a text badge.",
    fileTypes: "File type icons",
    fileTypesInfo: "Icons for files written in these languages and formats, in the file explorer.",
    fileTypesChangesTitle: "Changes from the original logos",
    fileTypesChanges:
      "material-icon-theme redrew these logos as file icons, and woowtech smart tones down their colors. Icons adapted from a logo under a Creative Commons ShareAlike license are shared under that same license.",
    mit: "MIT License",
    mitInfo:
      "The MIT License applies to each work below, under the copyright notice listed with it.",
    mitTextTitle: "License text",
  },
  owner: "Owner: {{owner}}",
  license: "License: {{license}}",
  source: "Source: {{source}}",
  publicDomain: "Public domain",
  logoOf: "{{name}} logo",
  changes: {
    singleColor: "Changes: redrawn in a single color",
  },
};

const THIRD_PARTY_NOTICES_ZH_TW: typeof THIRD_PARTY_NOTICES_ENGLISH = {
  title: "商標與第三方授權",
  statement:
    "渥屋智能與這裡列出的公司或專案沒有從屬關係，也沒有獲得它們的贊助或背書。這些名稱與標誌屬於各自的所有者，只用來標示它們代表的 Agent、服務與檔案類型。",
  sections: {
    trademarks: "商標",
    agents: "Agent",
    agentsInfo:
      "以自己的圖示顯示的 Agent，圖示是作者提供給 ACP 用戶端的版本。其他 Agent 顯示文字徽章。",
    forges: "Git 平台",
    forgesInfo:
      "顯示在開啟 Git 平台的連結旁。GitHub 與 Codeberg 只用黑色或白色顯示，GitLab 顯示文字徽章。",
    fileTypes: "檔案類型圖示",
    fileTypesInfo: "檔案總管裡，代表這些程式語言與格式的檔案圖示。",
    fileTypesChangesTitle: "與原始標誌的差異",
    fileTypesChanges:
      "material-icon-theme 把這些標誌重新繪製成檔案圖示，渥屋智能再調淡它們的顏色。改作自創用 CC「相同方式分享」授權標誌的圖示，以同一授權分享。",
    mit: "MIT 授權",
    mitInfo: "MIT 授權適用於下列每項作品，著作權聲明列在各項作品下。",
    mitTextTitle: "授權條文",
  },
  owner: "所有者：{{owner}}",
  license: "授權：{{license}}",
  source: "來源：{{source}}",
  publicDomain: "公眾領域",
  logoOf: "{{name}} 標誌",
  changes: {
    singleColor: "修改：重新繪製成單色",
  },
};

/** woowtech smart's own text in `language`. A language upstream adds later reads English. */
export function woowtechCopyFor(language: string) {
  return {
    ...(WOOWTECH_COPY[language] ?? ENGLISH),
    claudeSdk: language === "zh-TW" ? CLAUDE_SDK_ZH_TW : CLAUDE_SDK_ENGLISH,
    claudeAuth: language === "zh-TW" ? CLAUDE_AUTH_ZH_TW : CLAUDE_AUTH_ENGLISH,
    confirmDialog: { confirm: language === "zh-TW" ? "確認" : "Confirm" },
    metadataGeneration:
      language === "zh-TW" ? METADATA_GENERATION_ZH_TW : METADATA_GENERATION_ENGLISH,
    addProject: ADD_PROJECT_COPY[language] ?? ADD_PROJECT_ENGLISH,
    hostPicker: HOST_PICKER_COPY[language] ?? HOST_PICKER_ENGLISH,
    desktopNotifications:
      language === "zh-TW" ? DESKTOP_NOTIFICATIONS_ZH_TW : DESKTOP_NOTIFICATIONS_ENGLISH,
    agentNotificationTitles:
      language === "zh-TW" ? AGENT_NOTIFICATION_TITLES_ZH_TW : AGENT_NOTIFICATION_TITLES_ENGLISH,
    notificationDisplay:
      language === "zh-TW" ? NOTIFICATION_DISPLAY_ZH_TW : NOTIFICATION_DISPLAY_ENGLISH,
    composer: language === "zh-TW" ? COMPOSER_ZH_TW : COMPOSER_ENGLISH,
    schedules: language === "zh-TW" ? SCHEDULES_ZH_TW : SCHEDULES_ENGLISH,
    time: language === "zh-TW" ? TIME_ZH_TW : TIME_ENGLISH,
    message: language === "zh-TW" ? MESSAGE_ZH_TW : MESSAGE_ENGLISH,
    workspaceRecovery: language === "zh-TW" ? WORKSPACE_RECOVERY_ZH_TW : WORKSPACE_RECOVERY_ENGLISH,
    thirdPartyNotices:
      language === "zh-TW" ? THIRD_PARTY_NOTICES_ZH_TW : THIRD_PARTY_NOTICES_ENGLISH,
  };
}
