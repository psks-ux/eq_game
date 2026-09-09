/**
 * Optional chrome vocabulary in 8 scripts. Text is decoration only: every
 * instruction is delivered wordlessly, so nothing functional may depend on
 * `t()`. Unknown keys return '' and `t()` never throws.
 */

const FALLBACK_LANG = 'en';

/** Languages offered in Settings, each written in its own script. */
export const LANGS = [
  { code: 'en', native: 'English' },
  { code: 'es', native: 'Español' },
  { code: 'pt', native: 'Português' },
  { code: 'ru', native: 'Русский' },
  { code: 'ar', native: 'العربية' },
  { code: 'hi', native: 'हिन्दी' },
  { code: 'zh', native: '中文' },
  { code: 'sw', native: 'Kiswahili' }
];

/** Languages written right-to-left. */
const RTL_LANGS = ['ar'];

const STRINGS = {
  en: {
    start: 'Start',
    continue: 'Continue',
    retry: 'Try again',
    back: 'Back',
    close: 'Close',
    home: 'Home',
    test: 'Assessment',
    train: 'Train',
    progress: 'Progress',
    settings: 'Settings',
    about: 'About',
    locked: 'Locked',
    best: 'Best',
    streak: 'Streak',
    level: 'Level',
    stars: 'Stars',
    xp: 'Points',
    accuracy: 'Accuracy',
    index: 'Index',
    export: 'Export',
    import: 'Import',
    reset: 'Reset',
    language: 'Language',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'settings.reducedMotion': 'Reduced motion',
    'settings.highContrast': 'High contrast',
    'settings.showLabels': 'Show labels',
    'settings.sound': 'Sound',
    'factor.induction': 'Induction',
    'factor.spatial': 'Spatial',
    'factor.workingMemory': 'Working memory',
    'factor.relational': 'Relational',
    'factor.speed': 'Speed',
    'factor.flexibility': 'Flexibility',
    'tier.entry': 'Entry',
    'tier.strong': 'Strong',
    'tier.advanced': 'Advanced',
    'tier.exceptional': 'Exceptional',
    'tier.elite': 'Elite',
    'tier.apex': 'Apex',
    'result.qualified.headline': 'Qualified',
    'result.qualified.body': 'You reached the required level. Training is open.',
    'result.eliminated.headline': 'Not qualified',
    'result.eliminated.body': 'Your index is below the required level. Training is locked.',
    'caption.ci': 'The band shows the range your true score most likely falls in.',
    'caption.practice': 'Repeating the test raises the score through practice; the index is not a fixed trait.'
  },

  es: {
    start: 'Empezar',
    continue: 'Continuar',
    retry: 'Reintentar',
    back: 'Atrás',
    close: 'Cerrar',
    home: 'Inicio',
    test: 'Evaluación',
    train: 'Entrenar',
    progress: 'Progreso',
    settings: 'Ajustes',
    about: 'Acerca de',
    locked: 'Bloqueado',
    best: 'Mejor',
    streak: 'Racha',
    level: 'Nivel',
    stars: 'Estrellas',
    xp: 'Puntos',
    accuracy: 'Precisión',
    index: 'Índice',
    export: 'Exportar',
    import: 'Importar',
    reset: 'Restablecer',
    language: 'Idioma',
    'theme.light': 'Claro',
    'theme.dark': 'Oscuro',
    'settings.reducedMotion': 'Menos movimiento',
    'settings.highContrast': 'Alto contraste',
    'settings.showLabels': 'Mostrar etiquetas',
    'settings.sound': 'Sonido',
    'factor.induction': 'Inducción',
    'factor.spatial': 'Espacial',
    'factor.workingMemory': 'Memoria de trabajo',
    'factor.relational': 'Relacional',
    'factor.speed': 'Velocidad',
    'factor.flexibility': 'Flexibilidad',
    'tier.entry': 'Inicial',
    'tier.strong': 'Fuerte',
    'tier.advanced': 'Avanzado',
    'tier.exceptional': 'Excepcional',
    'tier.elite': 'Élite',
    'tier.apex': 'Cima',
    'result.qualified.headline': 'Clasificado',
    'result.qualified.body': 'Alcanzaste el nivel exigido. El entrenamiento está abierto.',
    'result.eliminated.headline': 'No clasificado',
    'result.eliminated.body': 'Tu índice está por debajo del nivel exigido. El entrenamiento está bloqueado.',
    'caption.ci': 'La franja muestra el rango donde probablemente está tu puntuación real.',
    'caption.practice': 'Repetir la prueba sube la puntuación por la práctica; el índice no es un rasgo fijo.'
  },

  pt: {
    start: 'Começar',
    continue: 'Continuar',
    retry: 'Tentar de novo',
    back: 'Voltar',
    close: 'Fechar',
    home: 'Início',
    test: 'Avaliação',
    train: 'Treinar',
    progress: 'Progresso',
    settings: 'Configurações',
    about: 'Sobre',
    locked: 'Bloqueado',
    best: 'Melhor',
    streak: 'Sequência',
    level: 'Nível',
    stars: 'Estrelas',
    xp: 'Pontos',
    accuracy: 'Precisão',
    index: 'Índice',
    export: 'Exportar',
    import: 'Importar',
    reset: 'Redefinir',
    language: 'Idioma',
    'theme.light': 'Claro',
    'theme.dark': 'Escuro',
    'settings.reducedMotion': 'Menos movimento',
    'settings.highContrast': 'Alto contraste',
    'settings.showLabels': 'Mostrar rótulos',
    'settings.sound': 'Som',
    'factor.induction': 'Indução',
    'factor.spatial': 'Espacial',
    'factor.workingMemory': 'Memória de trabalho',
    'factor.relational': 'Relacional',
    'factor.speed': 'Velocidade',
    'factor.flexibility': 'Flexibilidade',
    'tier.entry': 'Inicial',
    'tier.strong': 'Forte',
    'tier.advanced': 'Avançado',
    'tier.exceptional': 'Excepcional',
    'tier.elite': 'Elite',
    'tier.apex': 'Cume',
    'result.qualified.headline': 'Qualificado',
    'result.qualified.body': 'Você atingiu o nível exigido. O treino está liberado.',
    'result.eliminated.headline': 'Não qualificado',
    'result.eliminated.body': 'Seu índice está abaixo do nível exigido. O treino está bloqueado.',
    'caption.ci': 'A faixa mostra o intervalo em que sua pontuação real provavelmente está.',
    'caption.practice': 'Repetir o teste aumenta a pontuação pela prática; o índice não é um traço fixo.'
  },

  ru: {
    start: 'Начать',
    continue: 'Продолжить',
    retry: 'Ещё раз',
    back: 'Назад',
    close: 'Закрыть',
    home: 'Главная',
    test: 'Оценка',
    train: 'Тренировка',
    progress: 'Прогресс',
    settings: 'Настройки',
    about: 'О программе',
    locked: 'Закрыто',
    best: 'Лучший',
    streak: 'Серия',
    level: 'Уровень',
    stars: 'Звёзды',
    xp: 'Очки',
    accuracy: 'Точность',
    index: 'Индекс',
    export: 'Экспорт',
    import: 'Импорт',
    reset: 'Сброс',
    language: 'Язык',
    'theme.light': 'Светлая',
    'theme.dark': 'Тёмная',
    'settings.reducedMotion': 'Меньше движения',
    'settings.highContrast': 'Высокий контраст',
    'settings.showLabels': 'Показывать подписи',
    'settings.sound': 'Звук',
    'factor.induction': 'Индукция',
    'factor.spatial': 'Пространственный',
    'factor.workingMemory': 'Рабочая память',
    'factor.relational': 'Реляционный',
    'factor.speed': 'Скорость',
    'factor.flexibility': 'Гибкость',
    'tier.entry': 'Начальный',
    'tier.strong': 'Сильный',
    'tier.advanced': 'Продвинутый',
    'tier.exceptional': 'Исключительный',
    'tier.elite': 'Элита',
    'tier.apex': 'Вершина',
    'result.qualified.headline': 'Допуск получен',
    'result.qualified.body': 'Вы достигли нужного уровня. Тренировка открыта.',
    'result.eliminated.headline': 'Допуск не получен',
    'result.eliminated.body': 'Ваш индекс ниже нужного уровня. Тренировка закрыта.',
    'caption.ci': 'Полоса показывает диапазон, в котором вероятнее всего находится ваш истинный балл.',
    'caption.practice': 'Повторное прохождение повышает балл за счёт практики; индекс не является постоянным свойством.'
  },

  ar: {
    start: 'ابدأ',
    continue: 'متابعة',
    retry: 'أعد المحاولة',
    back: 'رجوع',
    close: 'إغلاق',
    home: 'الرئيسية',
    test: 'التقييم',
    train: 'تدريب',
    progress: 'التقدم',
    settings: 'الإعدادات',
    about: 'حول',
    locked: 'مقفل',
    best: 'الأفضل',
    streak: 'التتابع',
    level: 'المستوى',
    stars: 'النجوم',
    xp: 'النقاط',
    accuracy: 'الدقة',
    index: 'المؤشر',
    export: 'تصدير',
    import: 'استيراد',
    reset: 'إعادة ضبط',
    language: 'اللغة',
    'theme.light': 'فاتح',
    'theme.dark': 'داكن',
    'settings.reducedMotion': 'تقليل الحركة',
    'settings.highContrast': 'تباين عالٍ',
    'settings.showLabels': 'إظهار التسميات',
    'settings.sound': 'الصوت',
    'factor.induction': 'الاستقراء',
    'factor.spatial': 'المكاني',
    'factor.workingMemory': 'الذاكرة العاملة',
    'factor.relational': 'العلائقي',
    'factor.speed': 'السرعة',
    'factor.flexibility': 'المرونة',
    'tier.entry': 'مبتدئ',
    'tier.strong': 'قوي',
    'tier.advanced': 'متقدم',
    'tier.exceptional': 'استثنائي',
    'tier.elite': 'نخبة',
    'tier.apex': 'القمة',
    'result.qualified.headline': 'مؤهل',
    'result.qualified.body': 'لقد بلغت المستوى المطلوب. التدريب متاح الآن.',
    'result.eliminated.headline': 'غير مؤهل',
    'result.eliminated.body': 'مؤشرك أقل من المستوى المطلوب. التدريب مقفل.',
    'caption.ci': 'يوضح النطاق المدى الذي تقع فيه درجتك الحقيقية على الأرجح.',
    'caption.practice': 'تكرار الاختبار يرفع الدرجة بسبب التمرين؛ المؤشر ليس صفة ثابتة.'
  },

  hi: {
    start: 'शुरू करें',
    continue: 'जारी रखें',
    retry: 'फिर कोशिश करें',
    back: 'वापस',
    close: 'बंद करें',
    home: 'मुख्य',
    test: 'मूल्यांकन',
    train: 'अभ्यास',
    progress: 'प्रगति',
    settings: 'सेटिंग',
    about: 'परिचय',
    locked: 'बंद',
    best: 'सर्वश्रेष्ठ',
    streak: 'लगातार दिन',
    level: 'स्तर',
    stars: 'तारे',
    xp: 'अंक',
    accuracy: 'शुद्धता',
    index: 'सूचकांक',
    export: 'निर्यात',
    import: 'आयात',
    reset: 'रीसेट',
    language: 'भाषा',
    'theme.light': 'उजला',
    'theme.dark': 'गहरा',
    'settings.reducedMotion': 'कम गति',
    'settings.highContrast': 'उच्च कंट्रास्ट',
    'settings.showLabels': 'लेबल दिखाएँ',
    'settings.sound': 'ध्वनि',
    'factor.induction': 'आगमनात्मक',
    'factor.spatial': 'स्थानिक',
    'factor.workingMemory': 'कार्यशील स्मृति',
    'factor.relational': 'संबंधात्मक',
    'factor.speed': 'गति',
    'factor.flexibility': 'लचीलापन',
    'tier.entry': 'प्रारंभिक',
    'tier.strong': 'मज़बूत',
    'tier.advanced': 'उन्नत',
    'tier.exceptional': 'असाधारण',
    'tier.elite': 'श्रेष्ठ',
    'tier.apex': 'शिखर',
    'result.qualified.headline': 'उत्तीर्ण',
    'result.qualified.body': 'आपने आवश्यक स्तर प्राप्त किया। अभ्यास खुल गया है।',
    'result.eliminated.headline': 'अनुत्तीर्ण',
    'result.eliminated.body': 'आपका सूचकांक आवश्यक स्तर से नीचे है। अभ्यास बंद है।',
    'caption.ci': 'पट्टी वह दायरा दिखाती है जिसमें आपका वास्तविक अंक होने की सबसे अधिक संभावना है।',
    'caption.practice': 'बार-बार परीक्षा देने से अभ्यास के कारण अंक बढ़ते हैं; सूचकांक स्थायी गुण नहीं है।'
  },

  zh: {
    start: '开始',
    continue: '继续',
    retry: '重试',
    back: '返回',
    close: '关闭',
    home: '主页',
    test: '测评',
    train: '训练',
    progress: '进度',
    settings: '设置',
    about: '关于',
    locked: '已锁定',
    best: '最佳',
    streak: '连续天数',
    level: '等级',
    stars: '星',
    xp: '积分',
    accuracy: '正确率',
    index: '指数',
    export: '导出',
    import: '导入',
    reset: '重置',
    language: '语言',
    'theme.light': '浅色',
    'theme.dark': '深色',
    'settings.reducedMotion': '减少动效',
    'settings.highContrast': '高对比度',
    'settings.showLabels': '显示标签',
    'settings.sound': '声音',
    'factor.induction': '归纳',
    'factor.spatial': '空间',
    'factor.workingMemory': '工作记忆',
    'factor.relational': '关系',
    'factor.speed': '速度',
    'factor.flexibility': '灵活性',
    'tier.entry': '入门',
    'tier.strong': '较强',
    'tier.advanced': '进阶',
    'tier.exceptional': '卓越',
    'tier.elite': '精英',
    'tier.apex': '巅峰',
    'result.qualified.headline': '已达标',
    'result.qualified.body': '你已达到要求的水平，训练已开放。',
    'result.eliminated.headline': '未达标',
    'result.eliminated.body': '你的指数低于要求的水平，训练已锁定。',
    'caption.ci': '区间显示你的真实分数最可能落在的范围。',
    'caption.practice': '反复测试会因练习而提高分数；该指数并非固定不变的特质。'
  },

  sw: {
    start: 'Anza',
    continue: 'Endelea',
    retry: 'Jaribu tena',
    back: 'Rudi',
    close: 'Funga',
    home: 'Mwanzo',
    test: 'Tathmini',
    train: 'Mazoezi',
    progress: 'Maendeleo',
    settings: 'Mipangilio',
    about: 'Kuhusu',
    locked: 'Imefungwa',
    best: 'Bora',
    streak: 'Mfululizo',
    level: 'Ngazi',
    stars: 'Nyota',
    xp: 'Pointi',
    accuracy: 'Usahihi',
    index: 'Kipimo',
    export: 'Hamisha',
    import: 'Ingiza',
    reset: 'Weka upya',
    language: 'Lugha',
    'theme.light': 'Angavu',
    'theme.dark': 'Giza',
    'settings.reducedMotion': 'Punguza mwendo',
    'settings.highContrast': 'Utofautishaji mkubwa',
    'settings.showLabels': 'Onyesha lebo',
    'settings.sound': 'Sauti',
    'factor.induction': 'Utambuzi wa kanuni',
    'factor.spatial': 'Nafasi',
    'factor.workingMemory': 'Kumbukumbu ya kazi',
    'factor.relational': 'Uhusiano',
    'factor.speed': 'Kasi',
    'factor.flexibility': 'Ubadilikaji',
    'tier.entry': 'Mwanzo',
    'tier.strong': 'Imara',
    'tier.advanced': 'Ya juu',
    'tier.exceptional': 'Ya kipekee',
    'tier.elite': 'Bingwa',
    'tier.apex': 'Kilele',
    'result.qualified.headline': 'Umefuzu',
    'result.qualified.body': 'Umefikia kiwango kinachohitajika. Mazoezi yamefunguliwa.',
    'result.eliminated.headline': 'Hujafuzu',
    'result.eliminated.body': 'Kipimo chako kiko chini ya kiwango kinachohitajika. Mazoezi yamefungwa.',
    'caption.ci': 'Ukanda unaonyesha eneo ambalo alama yako halisi inaelekea kuwa.',
    'caption.practice': 'Kurudia mtihani huongeza alama kwa sababu ya mazoezi; kipimo si tabia isiyobadilika.'
  }
};

let currentLang = FALLBACK_LANG;
let labelsOn = true;

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Map an arbitrary tag ('pt-BR', 'ZH-hans', 'ar_EG') onto a supported code.
 * @param {*} code
 * @returns {string|null}
 */
function normalizeCode(code) {
  if (typeof code !== 'string' || code.length === 0) return null;
  const base = code.toLowerCase().replace('_', '-').split('-')[0];
  for (let i = 0; i < LANGS.length; i += 1) {
    if (LANGS[i].code === base) return LANGS[i].code;
  }
  return null;
}

/**
 * Look up a chrome string. Falls back to English, then to ''.
 * Never throws for any input.
 * @param {string} key
 * @param {object} [vars] values for `{name}` placeholders
 * @returns {string}
 */
export function t(key, vars) {
  try {
    if (typeof key !== 'string' || key.length === 0) return '';
    const table = STRINGS[currentLang];
    let s = table && hasOwn(table, key) ? table[key] : undefined;
    if (typeof s !== 'string') {
      const fb = STRINGS[FALLBACK_LANG];
      s = fb && hasOwn(fb, key) ? fb[key] : undefined;
    }
    if (typeof s !== 'string') return '';
    if (vars && typeof vars === 'object') {
      s = s.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => {
        if (!hasOwn(vars, name)) return match;
        const value = vars[name];
        if (value === null || value === undefined) return match;
        try {
          return String(value);
        } catch (_err) {
          return match;
        }
      });
    }
    return s;
  } catch (_err) {
    return '';
  }
}

/**
 * Switch language and, when a document exists, update `lang`/`dir` on <html>.
 * Unknown codes fall back to English rather than failing.
 * @param {string} code
 * @returns {string} the code actually applied
 */
export function setLang(code) {
  const resolved = normalizeCode(code) || FALLBACK_LANG;
  currentLang = resolved;
  try {
    if (typeof document !== 'undefined' && document && document.documentElement) {
      document.documentElement.lang = resolved;
      document.documentElement.dir = RTL_LANGS.indexOf(resolved) >= 0 ? 'rtl' : 'ltr';
    }
  } catch (_err) {
    // No document (tests / worker): language still switches for t().
  }
  return resolved;
}

/**
 * @returns {string} the active language code
 */
export function getLang() {
  return currentLang;
}

/**
 * Whether optional text labels should be shown. Mirrors
 * `profile.settings.showLabels`; the caller pushes the value in with
 * `setLabelsEnabled` so this module never imports the store.
 * @returns {boolean}
 */
export function labelsEnabled() {
  return labelsOn;
}

/**
 * Push the profile's `showLabels` setting into this module.
 * @param {boolean} on
 * @returns {boolean} the value now in effect
 */
export function setLabelsEnabled(on) {
  labelsOn = on !== false;
  return labelsOn;
}
