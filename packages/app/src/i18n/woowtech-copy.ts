// Text only woowtech smart shows. It loads under the `woowtech` key of every
// language's translations (t("woowtech.changelog.empty.title")), so upstream's
// locale files stay untouched. Every language has to carry every key: the type
// is English's shape.
const ENGLISH = {
  changelog: {
    empty: {
      title: "No release notes yet",
      description: "Release notes will show up here once the first version is released.",
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
  },
  "zh-CN": {
    changelog: {
      empty: {
        title: "还没有发布说明",
        description: "第一个版本发布后，发布说明就会显示在这里。",
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
  },
  ko: {
    changelog: {
      empty: {
        title: "아직 릴리스 노트가 없습니다",
        description: "첫 번째 버전이 출시되면 여기에 릴리스 노트가 표시됩니다.",
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
  },
  fr: {
    changelog: {
      empty: {
        title: "Aucune note de version pour l'instant",
        description:
          "Les notes de version s'afficheront ici dès la publication de la première version.",
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
  },
  ru: {
    changelog: {
      empty: {
        title: "Заметок о выпуске пока нет",
        description: "Заметки о выпуске появятся здесь после выхода первой версии.",
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
  },
};

/** woowtech smart's own text in `language`. A language upstream adds later reads English. */
export function woowtechCopyFor(language: string): WoowtechCopy {
  return WOOWTECH_COPY[language] ?? ENGLISH;
}
