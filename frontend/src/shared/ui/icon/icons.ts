/**
 * The icon set, named by meaning.
 *
 * Every glyph the product uses is chosen here and nowhere else. A component
 * imports `SearchIcon`, not `MagnifyingGlassIcon`, so replacing a glyph — or the
 * whole library — is an edit to this file rather than a search across the app.
 * It is also what keeps one set on every surface: there is no second place a
 * different library could be reached from.
 *
 * One concept, one alias. Where two roles genuinely share a meaning they share
 * the alias too, rather than growing a synonym that would let the two drift
 * apart.
 */
export {
  // Navigation and destinations.
  CompassIcon as BrowseIcon,
  BookOpenTextIcon as DocsIcon,
  UploadSimpleIcon as SubmitIcon,
  SquaresFourIcon as DashboardIcon,
  HouseIcon as HomeIcon,
  ArrowRightIcon as ForwardIcon,
  CaretLeftIcon as PreviousPageIcon,
  // Also the breadcrumb separator: both point one step further into the trail.
  CaretRightIcon as NextPageIcon,
  QuestionIcon as UnknownPageIcon,

  // Controls.
  MagnifyingGlassIcon as SearchIcon,
  SortAscendingIcon as SortIcon,
  ListIcon as MenuIcon,
  XIcon as CloseIcon,
  CopyIcon as CopyIcon,
  CheckIcon as ConfirmIcon,
  ProhibitIcon as DenyIcon,
  TranslateIcon as LanguageIcon,
  SunIcon as LightThemeIcon,
  MoonIcon as DarkThemeIcon,
  ArrowSquareOutIcon as ExternalLinkIcon,

  // Account, and the places the project and its maintainer can be reached.
  SignInIcon as SignInIcon,
  SignOutIcon as SignOutIcon,
  GithubLogoIcon as GithubIcon,
  DiscordLogoIcon as DiscordIcon,
  XLogoIcon as XIcon,
  EnvelopeSimpleIcon as EmailIcon,

  // Facts a catalog row carries.
  SealCheckIcon as VerifiedIcon,
  StarIcon as StarsIcon,
  CloudArrowDownIcon as DownloadsIcon,
  DownloadSimpleIcon as InstallsIcon,
  ScalesIcon as LicenseIcon,
  ClockCounterClockwiseIcon as UpdatedIcon,
  GaugeIcon as ScoreIcon,
  TrendUpIcon as RisingIcon,
  GitCommitIcon as CommitIcon,

  // Installing.
  TerminalWindowIcon as CliIcon,
  RobotIcon as AgentIcon,
  KeyIcon as CredentialIcon,

  // Outcomes and states.
  WarningIcon as WarningIcon,
  WarningCircleIcon as ErrorIcon,
  ClockIcon as PendingIcon,
  CheckCircleIcon as ApprovedIcon,
  XCircleIcon as RejectedIcon,
  ShieldCheckIcon as SecureIcon,

  // Artifact kinds.
  PackageIcon as BundleIcon,
  StackIcon as ProfileIcon,
  LightningIcon as SkillIcon,
  PlugsConnectedIcon as McpServerIcon,
  SlidersHorizontalIcon as AgentPresetIcon,
  BridgeIcon as HookBridgeIcon,

  // Categories.
  CodeIcon as CodingCategoryIcon,
  BinocularsIcon as ResearchCategoryIcon,
  DatabaseIcon as DataCategoryIcon,
  InfinityIcon as DevopsCategoryIcon,
  ListChecksIcon as ProductivityCategoryIcon,
  ChatCircleDotsIcon as CommunicationCategoryIcon,
  PenNibIcon as DesignCategoryIcon,
  LockKeyIcon as SecurityCategoryIcon,
  TestTubeIcon as TestingCategoryIcon,
  BrainIcon as ModelsCategoryIcon,
  LayoutIcon as UiCategoryIcon,
  DotsThreeCircleIcon as OtherCategoryIcon,
} from '@phosphor-icons/react'
