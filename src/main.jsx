import React, { useCallback, useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Copy,
  DownloadCloud,
  FileText,
  Gift,
  Landmark,
  LockKeyhole,
  LogOut,
  RefreshCcw,
  RotateCcw,
  Search,
  ShieldCheck,
  UserCog,
  Users,
  X,
} from "lucide-react"
import "./styles.css"

const LOCAL_API_URL = "http://localhost:5000"
const PUBLIC_SITE_URL = "https://streamtips.live"

function redirectLegacyPublicRoutes() {
  if (typeof window === "undefined") return false

  const pathname = String(window.location.pathname || "/")
    .replace(/\/+$/, "")
    .toLowerCase()

  if (pathname !== "/register") {
    return false
  }

  window.location.replace(`${PUBLIC_SITE_URL}/register${window.location.search || ""}${window.location.hash || ""}`)
  return true
}

function resolvePortalApiBaseUrl() {
  const configuredUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim()
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "")
  }

  if (typeof window !== "undefined") {
    const hostname = String(window.location.hostname || "").toLowerCase()
    const isLocalHost =
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"

    if (isLocalHost) {
      return LOCAL_API_URL
    }

    if (hostname === "streamtips.live" || hostname.endsWith(".streamtips.live")) {
      return "https://api.streamtips.live"
    }
  }

  return LOCAL_API_URL
}

const API_BASE_URL = resolvePortalApiBaseUrl()
const PAYSTACK_ENABLED = String(import.meta.env.VITE_PAYSTACK_ENABLED || "false").toLowerCase() === "true"
const TOKEN_KEY = "streamtip.portal.session"
const SETTLEMENT_PAGE_SIZE = 20
const USER_PAGE_SIZE = 25
const DONATION_PAGE_SIZE = 25
const COMPLIANCE_PAGE_SIZE = 25
const KYC_UPGRADE_PAGE_SIZE = 25
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000

const DEFAULT_PAGINATION = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 1,
  hasPrevious: false,
  hasNext: false,
}

const tabs = [
  { id: "settlements", label: "Settlements", icon: Landmark },
  { id: "gifts", label: "Gifts", icon: Gift },
  { id: "compliance", label: "Compliance", icon: AlertTriangle },
  { id: "kyc-upgrades", label: "KYC Upgrades", icon: ShieldCheck },
  { id: "changes", label: "Account Changes", icon: LockKeyhole },
  { id: "users", label: "Super Admin", icon: Users },
]

const settlementStatusOptions = [
  { value: "all", label: "All statuses" },
  { value: "pending_admin_approval", label: "Pending admin approval" },
  { value: "awaiting_review", label: "Awaiting review" },
  { value: "approved", label: "Approved" },
  { value: "otp_required", label: "OTP required" },
  { value: "otp_resent", label: "OTP resent" },
  { value: "processing", label: "Processing" },
  { value: "success", label: "Success" },
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
]

const complianceStatusOptions = [
  { value: "all", label: "All statuses" },
  { value: "held", label: "Held" },
  { value: "unmatched", label: "Unmatched" },
  { value: "paid", label: "Paid" },
  { value: "reversed", label: "Reversed" },
  { value: "resolved", label: "Resolved" },
]

const kycUpgradeStatusOptions = [
  { value: "all", label: "All statuses" },
  { value: "awaiting_review", label: "Awaiting review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
]

function formatCurrency(value) {
  return `NGN ${Number(value || 0).toLocaleString()}`
}

function formatDate(value) {
  if (!value) return "Not available"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Not available"
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function maskAccount(value) {
  const account = String(value || "")
  return account ? `**** ${account.slice(-4)}` : "No account"
}

function maskIdentityNumber(value) {
  const digits = String(value || "").trim()
  if (!digits) return "Not submitted"
  if (digits.length <= 4) return digits
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
}

function resolveIdentityNumber(user, type) {
  const keyUpper = type === "bvn" ? "Bvn" : "Nin"
  const identity = user?.identity || {}
  const candidates = [
    identity?.[type],
    identity?.[`submitted${keyUpper}`],
    user?.[type],
    user?.[`submitted${keyUpper}`],
    user?.[`submitted${String(type).toUpperCase()}`],
  ]

  for (const candidate of candidates) {
    const value = String(candidate || "").trim()
    if (value) return value
  }

  return ""
}

function formatSourceAccountNumber(value) {
  const account = String(value || "").trim()

  if (!account) {
    return "Not synced"
  }

  return account.includes("*") ? `${account} (masked by provider)` : account
}

function statusTone(status) {
  if (["completed", "success", "approved", "available", "verified", "active"].includes(status)) return "success"
  if (
    [
      "awaiting_review",
      "pending_admin_approval",
      "pending",
      "pending_authorization",
      "otp_required",
      "otp_resent",
      "processing",
      "pending_review",
      "retry_ready",
      "suspended",
    ].includes(status)
  ) return "warning"
  if (["failed", "rejected", "banned", "held", "unmatched"].includes(status)) return "danger"
  if (["cancelled", "canceled"].includes(status)) return "muted"
  return "muted"
}

function normalizePagination(pagination, fallbackLimit) {
  return {
    ...DEFAULT_PAGINATION,
    limit: fallbackLimit,
    ...(pagination || {}),
  }
}

function normalizePayoutProvider(value) {
  const provider = String(value || "").toLowerCase().trim()
  return provider === "paystack" ? "paystack" : provider === "monnify" ? "monnify" : "unknown"
}

function appendAdminTokenToPath(path, token) {
  const separator = String(path || "").includes("?") ? "&" : "?"
  return `${path}${separator}adminToken=${encodeURIComponent(token)}`
}

function formatPayoutProviderLabel(value) {
  const provider = normalizePayoutProvider(value)
  if (provider === "paystack") return "Paystack"
  if (provider === "monnify") return "Monnify"
  return "Unknown"
}

function buildSettlementParams(filters, includePagination = true) {
  const params = new URLSearchParams()

  if (includePagination) {
    params.set("page", String(filters.page || 1))
    params.set("limit", String(filters.limit || SETTLEMENT_PAGE_SIZE))
  }

  if (filters.status && filters.status !== "all") {
    params.set("status", filters.status)
  }

  if (String(filters.search || "").trim()) {
    params.set("search", String(filters.search).trim())
  }

  return params.toString()
}

function buildDonationParams(filters, includePagination = true) {
  const params = new URLSearchParams()

  if (includePagination) {
    params.set("page", String(filters.page || 1))
    params.set("limit", String(filters.limit || DONATION_PAGE_SIZE))
  }

  if (String(filters.search || "").trim()) {
    params.set("search", String(filters.search).trim())
  }

  if (String(filters.from || "").trim()) {
    params.set("from", String(filters.from).trim())
  }

  if (String(filters.to || "").trim()) {
    params.set("to", String(filters.to).trim())
  }

  if (String(filters.creatorId || "").trim()) {
    params.set("creatorId", String(filters.creatorId).trim())
  }

  return params.toString()
}

function buildComplianceParams(filters, includePagination = true) {
  const params = new URLSearchParams()

  if (includePagination) {
    params.set("page", String(filters.page || 1))
    params.set("limit", String(filters.limit || COMPLIANCE_PAGE_SIZE))
  }

  if (filters.status && filters.status !== "all") {
    params.set("status", filters.status)
  }

  if (String(filters.search || "").trim()) {
    params.set("search", String(filters.search).trim())
  }

  if (String(filters.from || "").trim()) {
    params.set("from", String(filters.from).trim())
  }

  if (String(filters.to || "").trim()) {
    params.set("to", String(filters.to).trim())
  }

  return params.toString()
}

function buildUserParams({ search, page, limit }) {
  const params = new URLSearchParams()
  params.set("page", String(page || 1))
  params.set("limit", String(limit || USER_PAGE_SIZE))

  if (String(search || "").trim()) {
    params.set("search", String(search).trim())
  }

  return params.toString()
}

function buildKycUpgradeParams(filters, includePagination = true) {
  const params = new URLSearchParams()

  if (includePagination) {
    params.set("page", String(filters.page || 1))
    params.set("limit", String(filters.limit || KYC_UPGRADE_PAGE_SIZE))
  }

  if (filters.status && filters.status !== "all") {
    params.set("status", filters.status)
  }

  return params.toString()
}

function getFilenameFromDisposition(value) {
  const match = String(value || "").match(/filename="?([^"]+)"?/i)
  return match?.[1] || ""
}

function getFirstName(user) {
  return user?.firstName || user?.identity?.firstName || ""
}

function getLastName(user) {
  return user?.lastName || user?.identity?.lastName || ""
}

function buildDonationReceiptText(donation) {
  if (!donation) return ""

  return [
    "StreamTip Gift Transaction",
    `Donation ID: ${donation.id || "Not available"}`,
    `Received: ${formatDate(donation.date)}`,
    `Provider Paid At: ${formatDate(donation.paidOn)}`,
    `Amount: ${formatCurrency(donation.amount)}`,
    `Creator: ${donation.creator?.name || donation.creatorEmail || "Not available"}`,
    `Creator Email: ${donation.creatorEmail || donation.creator?.email || "Not available"}`,
    `Destination VA: ${donation.destinationAccountNumber || "Not available"} (${donation.destinationBankName || "No bank"})`,
    `Source Name: ${donation.sourceAccountName || "Not stored"}`,
    `Source Account: ${formatSourceAccountNumber(donation.sourceAccountNumber)}`,
    `Source Bank: ${donation.sourceBankName || "Not available"}`,
    `Source Session ID: ${donation.sourceSessionId || "Not stored"}`,
    `Streamer Alert Name: ${donation.sender || "Anonymous"}`,
    `Provider: ${donation.provider || "Not available"}`,
    `Transaction Reference: ${donation.transactionReference || donation.monnifyTransactionReference || donation.paystackReference || "Not available"}`,
    `Payment Reference: ${donation.monnifyPaymentReference || donation.paystackReference || "Not available"}`,
    `Paystack Transaction ID: ${donation.paystackTransactionId || "Not available"}`,
    `Wallet Status: ${donation.walletStatus || "available"}`,
    `Settlement Status: ${donation.settlementStatus || "pending"}`,
    `Creator Settled Amount: ${formatCurrency(donation.creatorSettledAmount || 0)}`,
    `Settlement Pending Amount: ${formatCurrency(donation.settlementPendingAmount || 0)}`,
    `Risk Reason: ${donation.riskReason || "None"}`,
    `Payment Method: ${donation.paymentMethod || "Not available"}`,
    `Purpose: Gift/donation to a StreamTip creator through a dedicated virtual account.`,
  ].join("\n")
}

function buildComplianceInflowSummary(inflow) {
  if (!inflow) return ""

  return [
    "StreamTip Compliance Inflow",
    `Inflow ID: ${inflow.id || "Not available"}`,
    `Date: ${formatDate(inflow.date)}`,
    `Status: ${inflow.status || "held"}`,
    `Validation Reason: ${inflow.validationReason || "Not recorded"}`,
    `Amount: ${formatCurrency(inflow.amount)}`,
    `Payment Status: ${inflow.paymentStatus || "Not available"}`,
    `Linked Creator: ${inflow.linkedCreator?.name || inflow.linkedCreatorEmail || "Not linked"}`,
    `Destination VA: ${inflow.destinationAccountNumber || "Not available"} (${inflow.destinationBankName || "No bank"})`,
    `Reserved Account Ref: ${inflow.reservedAccountReference || "Not available"}`,
    `Source Name: ${inflow.sourceAccountName || "Not stored"}`,
    `Source Account: ${formatSourceAccountNumber(inflow.sourceAccountNumber)}`,
    `Source Bank: ${inflow.sourceBankName || "Not available"}`,
    `Source Session ID: ${inflow.sourceSessionId || "Not stored"}`,
    `Provider: ${inflow.provider || "Not available"}`,
    `Transaction Reference: ${inflow.transactionReference || inflow.monnifyTransactionReference || inflow.paystackReference || "Not available"}`,
    `Payment Reference: ${inflow.monnifyPaymentReference || inflow.paystackReference || "Not available"}`,
    `Paystack Transaction ID: ${inflow.paystackTransactionId || "Not available"}`,
    `Admin Notes: ${inflow.adminNotes || "None"}`,
  ].join("\n")
}

function getVerificationTypesForRequest(type) {
  const normalized = String(type || "both").toLowerCase().trim()
  if (normalized === "bvn") return ["bvn"]
  if (normalized === "nin") return ["nin"]
  return ["bvn", "nin"]
}

function buildVerificationToast(payload, type) {
  if (typeof payload?.success === "boolean") {
    const mismatches = Array.isArray(payload?.mismatches) ? payload.mismatches : []
    const mismatchText = mismatches.length
      ? mismatches
          .map((item) => `${item?.field || "field"}: ${item?.message || item?.status || "NO_MATCH"}`)
          .join(" | ")
      : ""

    return {
      tone: payload.success ? "success" : "danger",
      message: payload.success
        ? String(payload?.message || "Identity verification passed and saved.")
        : [String(payload?.message || "Identity verification failed."), mismatchText].filter(Boolean).join(" | "),
    }
  }

  const verification = payload?.verification || payload?.user?.identityVerification || {}
  const requestedTypes = getVerificationTypesForRequest(type)
  const failed = requestedTypes.filter((item) => {
    const status = String(verification?.[item]?.status || "").toLowerCase()
    return status !== "verified"
  })

  if (!failed.length) {
    const label = requestedTypes.length === 2 ? "BVN and NIN" : requestedTypes[0].toUpperCase()
    return {
      tone: "success",
      message: `Monnify ${label} verification passed and saved.`,
    }
  }

  const details = failed
    .map((item) => {
      const snapshot = verification?.[item] || {}
      const reason = String(snapshot.responseMessage || snapshot.matchStatus || "verification failed").trim()
      return `${item.toUpperCase()}: ${reason}`
    })
    .join(" | ")

  return {
    tone: "danger",
    message: `Verification completed but not validated. ${details}`,
  }
}

function App() {
  const [token, setToken] = useState(() => window.localStorage.getItem(TOKEN_KEY) || "")
  const [admin, setAdmin] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [activeTab, setActiveTab] = useState("settlements")
  const [settlements, setSettlements] = useState([])
  const [settlementQueuePagination, setSettlementQueuePagination] = useState(() =>
    normalizePagination(null, SETTLEMENT_PAGE_SIZE),
  )
  const [settlementQueueFilters, setSettlementQueueFilters] = useState({
    search: "",
    page: 1,
    limit: SETTLEMENT_PAGE_SIZE,
  })
  const [selectedSettlementId, setSelectedSettlementId] = useState("")
  const [settlementHistory, setSettlementHistory] = useState([])
  const [settlementHistoryPagination, setSettlementHistoryPagination] = useState(() =>
    normalizePagination(null, SETTLEMENT_PAGE_SIZE),
  )
  const [settlementFilters, setSettlementFilters] = useState({
    search: "",
    status: "all",
    page: 1,
    limit: SETTLEMENT_PAGE_SIZE,
  })
  const [settlementTransferProvider, setSettlementTransferProvider] = useState("unknown")
  const [donations, setDonations] = useState([])
  const [donationsPagination, setDonationsPagination] = useState(() =>
    normalizePagination(null, DONATION_PAGE_SIZE),
  )
  const [donationFilters, setDonationFilters] = useState({
    search: "",
    from: "",
    to: "",
    page: 1,
    limit: DONATION_PAGE_SIZE,
  })
  const [selectedDonationId, setSelectedDonationId] = useState("")
  const [selectedDonationDetails, setSelectedDonationDetails] = useState(null)
  const [complianceInflows, setComplianceInflows] = useState([])
  const [compliancePagination, setCompliancePagination] = useState(() =>
    normalizePagination(null, COMPLIANCE_PAGE_SIZE),
  )
  const [complianceFilters, setComplianceFilters] = useState({
    search: "",
    status: "all",
    from: "",
    to: "",
    page: 1,
    limit: COMPLIANCE_PAGE_SIZE,
  })
  const [selectedComplianceInflowId, setSelectedComplianceInflowId] = useState("")
  const [selectedComplianceInflowDetails, setSelectedComplianceInflowDetails] = useState(null)
  const [complianceEdits, setComplianceEdits] = useState({})
  const [kycUpgradeSubmissions, setKycUpgradeSubmissions] = useState([])
  const [kycUpgradePagination, setKycUpgradePagination] = useState(() =>
    normalizePagination(null, KYC_UPGRADE_PAGE_SIZE),
  )
  const [kycUpgradeFilters, setKycUpgradeFilters] = useState({
    status: "all",
    page: 1,
    limit: KYC_UPGRADE_PAGE_SIZE,
  })
  const [selectedKycUpgradeId, setSelectedKycUpgradeId] = useState("")
  const [changeRequests, setChangeRequests] = useState([])
  const [users, setUsers] = useState([])
  const [usersPagination, setUsersPagination] = useState(() =>
    normalizePagination(null, USER_PAGE_SIZE),
  )
  const [userSearch, setUserSearch] = useState("")
  const [selectedUserId, setSelectedUserId] = useState("")
  const [selectedUserDetails, setSelectedUserDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busyAction, setBusyAction] = useState("")
  const [toast, setToast] = useState(null)
  const [settlementReasons, setSettlementReasons] = useState({})
  const [settlementOtps, setSettlementOtps] = useState({})
  const [changeReasons, setChangeReasons] = useState({})
  const [cooldowns, setCooldowns] = useState({})
  const [userEdits, setUserEdits] = useState({})

  const requestRaw = useCallback(
    async (path, options = {}) => {
      const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...requestOptions } = options || {}
      const method = String(requestOptions.method || "GET").toUpperCase()
      const createRequest = (requestPath, includeAdminHeader = true) => {
        const headers = new Headers(requestOptions.headers || {})

        if (requestOptions.body && !headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json")
        }

        if (includeAdminHeader && token) {
          headers.set("x-admin-token", token)
        }

        const fetchPromise = fetch(`${API_BASE_URL}${requestPath}`, {
          ...requestOptions,
          method,
          headers,
        })
        const timeout = Number(timeoutMs)

        if (!Number.isFinite(timeout) || timeout <= 0) {
          return fetchPromise
        }

        return Promise.race([
          fetchPromise,
          new Promise((_, reject) => {
            window.setTimeout(() => reject(new Error("Portal request timed out.")), timeout)
          }),
        ])
      }

      try {
        return await createRequest(path, true)
      } catch (error) {
        if (!token || method !== "GET") {
          throw error
        }

        return createRequest(appendAdminTokenToPath(path, token), false)
      }
    },
    [token],
  )

  const request = useCallback(
    async (path, options = {}) => {
      const response = await requestRaw(path, options)
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        const error = new Error(payload?.error || payload?.message || "Portal request failed.")
        error.status = response.status
        throw error
      }

      return payload
    },
    [requestRaw],
  )

  const requestFile = useCallback(
    async (path, options = {}) => {
      const headers = new Headers(options.headers || {})

      const response = await requestRaw(path, {
        ...options,
        headers,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        const error = new Error(payload?.error || payload?.message || "Portal request failed.")
        error.status = response.status
        throw error
      }

      return response
    },
    [requestRaw],
  )

  const loadSettlementQueue = useCallback(
    async (overrides = {}) => {
      const nextFilters = {
        ...settlementQueueFilters,
        ...overrides,
        limit: overrides.limit || settlementQueueFilters.limit || SETTLEMENT_PAGE_SIZE,
      }
      const payload = await request(`/portal/settlements?${buildSettlementParams(nextFilters)}`)

      setSettlements(Array.isArray(payload?.payouts) ? payload.payouts : [])
      setSettlementTransferProvider(
        normalizePayoutProvider(payload?.creatorWithdrawalProvider || payload?.payoutTransferProvider),
      )
      setSettlementQueuePagination(
        normalizePagination(payload?.pagination, nextFilters.limit || SETTLEMENT_PAGE_SIZE),
      )
      setSettlementQueueFilters(nextFilters)
    },
    [request, settlementQueueFilters],
  )

  const loadSettlementHistory = useCallback(
    async (overrides = {}) => {
      const nextFilters = {
        ...settlementFilters,
        ...overrides,
        limit: overrides.limit || settlementFilters.limit || SETTLEMENT_PAGE_SIZE,
      }
      const payload = await request(`/portal/settlements/history?${buildSettlementParams(nextFilters)}`)

      setSettlementHistory(Array.isArray(payload?.payouts) ? payload.payouts : [])
      if (payload?.creatorWithdrawalProvider || payload?.payoutTransferProvider) {
        setSettlementTransferProvider(
          normalizePayoutProvider(payload?.creatorWithdrawalProvider || payload?.payoutTransferProvider),
        )
      }
      setSettlementHistoryPagination(
        normalizePagination(payload?.pagination, nextFilters.limit || SETTLEMENT_PAGE_SIZE),
      )
      setSettlementFilters(nextFilters)
    },
    [request, settlementFilters],
  )

  const loadDonations = useCallback(
    async (overrides = {}) => {
      const nextFilters = {
        ...donationFilters,
        ...overrides,
        limit: overrides.limit || donationFilters.limit || DONATION_PAGE_SIZE,
      }
      const payload = await request(`/portal/donations?${buildDonationParams(nextFilters)}`)

      setDonations(Array.isArray(payload?.donations) ? payload.donations : [])
      setDonationsPagination(
        normalizePagination(payload?.pagination, nextFilters.limit || DONATION_PAGE_SIZE),
      )
      setDonationFilters(nextFilters)
    },
    [donationFilters, request],
  )

  const loadComplianceInflows = useCallback(
    async (overrides = {}) => {
      const nextFilters = {
        ...complianceFilters,
        ...overrides,
        limit: overrides.limit || complianceFilters.limit || COMPLIANCE_PAGE_SIZE,
      }
      const payload = await request(`/portal/compliance-inflows?${buildComplianceParams(nextFilters)}`)

      setComplianceInflows(Array.isArray(payload?.inflows) ? payload.inflows : [])
      setCompliancePagination(
        normalizePagination(payload?.pagination, nextFilters.limit || COMPLIANCE_PAGE_SIZE),
      )
      setComplianceFilters(nextFilters)
    },
    [complianceFilters, request],
  )

  const loadKycUpgradeSubmissions = useCallback(
    async (overrides = {}) => {
      const nextFilters = {
        ...kycUpgradeFilters,
        ...overrides,
        limit: overrides.limit || kycUpgradeFilters.limit || KYC_UPGRADE_PAGE_SIZE,
      }
      const payload = await request(`/portal/kyc-upgrade-submissions?${buildKycUpgradeParams(nextFilters)}`)

      setKycUpgradeSubmissions(Array.isArray(payload?.submissions) ? payload.submissions : [])
      setKycUpgradePagination(
        normalizePagination(payload?.pagination, nextFilters.limit || KYC_UPGRADE_PAGE_SIZE),
      )
      setKycUpgradeFilters(nextFilters)
    },
    [kycUpgradeFilters, request],
  )

  const loadUsers = useCallback(
    async (overrides = {}) => {
      const nextSearch = Object.prototype.hasOwnProperty.call(overrides, "search")
        ? overrides.search
        : userSearch
      const nextPage = overrides.page || usersPagination.page || 1
      const nextLimit = overrides.limit || usersPagination.limit || USER_PAGE_SIZE
      const payload = await request(
        `/portal/users?${buildUserParams({ search: nextSearch, page: nextPage, limit: nextLimit })}`,
      )

      setUsers(Array.isArray(payload?.users) ? payload.users : [])
      setUsersPagination(normalizePagination(payload?.pagination, nextLimit))
      setUserSearch(nextSearch)
    },
    [request, userSearch, usersPagination.limit, usersPagination.page],
  )

  const refreshAll = useCallback(
    async (options = {}) => {
      const { scope = "all", showLoading = true, silent = false } = options
      if (!token) return

      const quickFirstPaint = scope === "initial"
      const timeoutMs = quickFirstPaint ? 5_000 : DEFAULT_REQUEST_TIMEOUT_MS

      if (showLoading) {
        setLoading(true)
      }

      const failedMessages = []
      const settlementProviderRef = {
        hasPrimary: false,
      }

      const tasks = [
        {
          key: "settlements",
          enabled:
            scope === "all" ||
            quickFirstPaint ||
            activeTab === "settlements",
          run: () =>
            request(`/portal/settlements?${buildSettlementParams(settlementQueueFilters)}`, {
              timeoutMs,
            }),
          apply: (payload) => {
            setSettlements(Array.isArray(payload?.payouts) ? payload.payouts : [])
            setSettlementTransferProvider(
              normalizePayoutProvider(
                payload?.creatorWithdrawalProvider || payload?.payoutTransferProvider,
              ),
            )
            settlementProviderRef.hasPrimary = Boolean(
              payload?.creatorWithdrawalProvider || payload?.payoutTransferProvider,
            )
            setSettlementQueuePagination(
              normalizePagination(
                payload?.pagination,
                settlementQueueFilters.limit || SETTLEMENT_PAGE_SIZE,
              ),
            )
          },
        },
        {
          key: "changes",
          enabled: scope === "all" || activeTab === "changes",
          run: () => request("/portal/payout-profile-change-requests", { timeoutMs }),
          apply: (payload) => {
            setChangeRequests(Array.isArray(payload?.requests) ? payload.requests : [])
          },
        },
        {
          key: "history",
          enabled:
            scope === "all" ||
            quickFirstPaint ||
            activeTab === "settlements",
          run: () =>
            request(`/portal/settlements/history?${buildSettlementParams(settlementFilters)}`, {
              timeoutMs,
            }),
          apply: (payload) => {
            setSettlementHistory(Array.isArray(payload?.payouts) ? payload.payouts : [])
            if (
              !settlementProviderRef.hasPrimary &&
              (payload?.creatorWithdrawalProvider || payload?.payoutTransferProvider)
            ) {
              setSettlementTransferProvider(
                normalizePayoutProvider(
                  payload?.creatorWithdrawalProvider || payload?.payoutTransferProvider,
                ),
              )
            }
            setSettlementHistoryPagination(
              normalizePagination(payload?.pagination, settlementFilters.limit || SETTLEMENT_PAGE_SIZE),
            )
          },
        },
        {
          key: "donations",
          enabled: scope === "all" || activeTab === "gifts",
          run: () =>
            request(`/portal/donations?${buildDonationParams(donationFilters)}`, {
              timeoutMs,
            }),
          apply: (payload) => {
            setDonations(Array.isArray(payload?.donations) ? payload.donations : [])
            setDonationsPagination(
              normalizePagination(payload?.pagination, donationFilters.limit || DONATION_PAGE_SIZE),
            )
          },
        },
        {
          key: "compliance",
          enabled: scope === "all" || activeTab === "compliance",
          run: () =>
            request(`/portal/compliance-inflows?${buildComplianceParams(complianceFilters)}`, {
              timeoutMs,
            }),
          apply: (payload) => {
            setComplianceInflows(Array.isArray(payload?.inflows) ? payload.inflows : [])
            setCompliancePagination(
              normalizePagination(payload?.pagination, complianceFilters.limit || COMPLIANCE_PAGE_SIZE),
            )
          },
        },
        {
          key: "kyc",
          enabled: scope === "all" || activeTab === "kyc-upgrades",
          run: () =>
            request(`/portal/kyc-upgrade-submissions?${buildKycUpgradeParams(kycUpgradeFilters)}`, {
              timeoutMs,
            }),
          apply: (payload) => {
            setKycUpgradeSubmissions(
              Array.isArray(payload?.submissions) ? payload.submissions : [],
            )
            setKycUpgradePagination(
              normalizePagination(
                payload?.pagination,
                kycUpgradeFilters.limit || KYC_UPGRADE_PAGE_SIZE,
              ),
            )
          },
        },
        {
          key: "users",
          enabled:
            scope === "all" ||
            quickFirstPaint ||
            activeTab === "users" ||
            activeTab === "compliance",
          run: () =>
            request(
              `/portal/users?${buildUserParams({
                search: userSearch,
                page: usersPagination.page,
                limit: usersPagination.limit,
              })}`,
              { timeoutMs },
            ),
          apply: (payload) => {
            setUsers(Array.isArray(payload?.users) ? payload.users : [])
            setUsersPagination(
              normalizePagination(payload?.pagination, usersPagination.limit || USER_PAGE_SIZE),
            )
          },
        },
      ].filter((task) => task.enabled)

      try {
        await Promise.all(
          tasks.map(async (task) => {
            try {
              const payload = await task.run()
              task.apply(payload)
            } catch (error) {
              failedMessages.push(error?.message || `${task.key} request failed.`)
            }
          }),
        )

        if (failedMessages.length && !silent) {
          const firstMessage = String(failedMessages[0] || "Some portal data failed to load.")
          setToast({
            tone: "danger",
            message:
              failedMessages.length > 1
                ? `${firstMessage} (${failedMessages.length} requests failed; showing partial data.)`
                : firstMessage,
          })
        }
      } catch (error) {
        if (!silent) {
          setToast({ tone: "danger", message: error.message })
        }
      } finally {
        if (showLoading) {
          setLoading(false)
        }
      }
    },
    [
      activeTab,
      request,
      complianceFilters,
      donationFilters,
      kycUpgradeFilters,
      settlementFilters,
      settlementQueueFilters,
      token,
      userSearch,
      usersPagination.limit,
      usersPagination.page,
    ],
  )

  useEffect(() => {
    let mounted = true

    async function checkSession() {
      if (!token) {
        setAdmin(null)
        setAuthChecked(true)
        return
      }

      const tokenSnapshot = token

      try {
        const payload = await request("/admin/auth/me")
        if (!mounted) return
        setAdmin(payload.admin || null)
        setAuthChecked(true)
      } catch (error) {
        if (!mounted) return
        const status = Number(error?.status || 0)
        const latestToken = window.localStorage.getItem(TOKEN_KEY) || ""
        const isSameRequestToken = latestToken && latestToken === tokenSnapshot

        if ((status === 401 || status === 403) && isSameRequestToken) {
          window.localStorage.removeItem(TOKEN_KEY)
          setToken("")
        }
        setAdmin(null)
        setAuthChecked(true)
      }
    }

    void checkSession()

    return () => {
      mounted = false
    }
  }, [request, token])

  useEffect(() => {
    if (admin) {
      void refreshAll({ scope: "initial" })
      window.setTimeout(() => {
        void refreshAll({ scope: "all", showLoading: false, silent: true })
      }, 120)
    }
  }, [admin])

  useEffect(() => {
    if (!admin) return

    if (activeTab === "gifts" && donations.length === 0) {
      void loadDonations({ page: donationFilters.page || 1 })
      return
    }

    if (activeTab === "compliance" && complianceInflows.length === 0) {
      void loadComplianceInflows({ page: complianceFilters.page || 1 })
      if (users.length === 0) {
        void loadUsers({ page: usersPagination.page || 1 })
      }
      return
    }

    if (activeTab === "kyc-upgrades" && kycUpgradeSubmissions.length === 0) {
      void loadKycUpgradeSubmissions({ page: kycUpgradeFilters.page || 1 })
      return
    }

    if (activeTab === "changes" && changeRequests.length === 0) {
      void request("/portal/payout-profile-change-requests")
        .then((payload) => {
          setChangeRequests(Array.isArray(payload?.requests) ? payload.requests : [])
        })
        .catch(() => null)
      return
    }

    if (activeTab === "users" && users.length === 0) {
      void loadUsers({ page: usersPagination.page || 1 })
    }
  }, [
    activeTab,
    admin,
    changeRequests.length,
    complianceFilters.page,
    complianceInflows.length,
    donationFilters.page,
    donations.length,
    kycUpgradeFilters.page,
    kycUpgradeSubmissions.length,
    loadComplianceInflows,
    loadDonations,
    loadKycUpgradeSubmissions,
    loadUsers,
    request,
    users.length,
    usersPagination.page,
  ])

  const selectedUser = useMemo(() => {
    return selectedUserDetails?.user || users.find((user) => String(user.id) === String(selectedUserId)) || null
  }, [selectedUserDetails, selectedUserId, users])

  const selectedDonation = useMemo(() => {
    return (
      selectedDonationDetails?.donation ||
      donations.find((donation) => String(donation.id) === String(selectedDonationId)) ||
      null
    )
  }, [donations, selectedDonationDetails, selectedDonationId])

  const selectedComplianceInflow = useMemo(() => {
    return (
      selectedComplianceInflowDetails?.inflow ||
      complianceInflows.find((inflow) => String(inflow.id) === String(selectedComplianceInflowId)) ||
      null
    )
  }, [complianceInflows, selectedComplianceInflowDetails, selectedComplianceInflowId])

  const selectedKycUpgradeSubmission = useMemo(() => {
    return kycUpgradeSubmissions.find((submission) => String(submission.id) === String(selectedKycUpgradeId)) || null
  }, [kycUpgradeSubmissions, selectedKycUpgradeId])

  const selectedSettlement = useMemo(() => {
    return settlements.find((payout) => String(payout.id) === String(selectedSettlementId)) || null
  }, [selectedSettlementId, settlements])

  const metrics = useMemo(
    () => [
      {
        label: "Review Queue",
        value: settlementQueuePagination.total,
        icon: Clock3,
        tone: settlementQueuePagination.total ? "warning" : "success",
      },
      {
        label: "Settlement Records",
        value: settlementHistoryPagination.total,
        icon: CircleDollarSign,
        tone: "neutral",
      },
      {
        label: "Gift Inflows",
        value: donationsPagination.total,
        icon: Gift,
        tone: "neutral",
      },
      {
        label: "Compliance Inflows",
        value: compliancePagination.total,
        icon: AlertTriangle,
        tone: compliancePagination.total ? "warning" : "success",
      },
      {
        label: "KYC Upgrades",
        value: kycUpgradeSubmissions.filter((item) => item.status === "awaiting_review").length,
        icon: ShieldCheck,
        tone: kycUpgradeSubmissions.some((item) => item.status === "awaiting_review") ? "warning" : "success",
      },
      {
        label: "Account Changes",
        value: changeRequests.filter((item) => item.status === "awaiting_review").length,
        icon: LockKeyhole,
        tone: "warning",
      },
      {
        label: "User Records",
        value: usersPagination.total,
        icon: Users,
        tone: "neutral",
      },
    ],
    [
      changeRequests,
      compliancePagination.total,
      donationsPagination.total,
      kycUpgradeSubmissions,
      settlementHistoryPagination.total,
      settlementQueuePagination.total,
      usersPagination.total,
    ],
  )

  const handleLogin = async ({ email, password }) => {
    setBusyAction("login")
    try {
      const response = await fetch(`${API_BASE_URL}/admin/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(payload?.error || "Admin login failed.")
      }

      window.localStorage.setItem(TOKEN_KEY, payload.token)
      setToken(payload.token)
      setAdmin(payload.admin)
      setToast({ tone: "success", message: "Signed in to StreamTip Portal." })
    } catch (error) {
      setToast({ tone: "danger", message: error.message })
    } finally {
      setBusyAction("")
    }
  }

  const handleLogout = async () => {
    try {
      await request("/admin/auth/logout", { method: "POST" })
    } catch {
      // Session may already be gone server-side.
    }
    window.localStorage.removeItem(TOKEN_KEY)
    setToken("")
    setAdmin(null)
  }

  const runAction = async (actionKey, action) => {
    setBusyAction(actionKey)
    setToast(null)
    try {
      const result = await action()
      const nextToast =
        result && typeof result === "object" && !Array.isArray(result)
          ? {
              tone: result.tone || "success",
              message: result.message || "Portal action completed.",
            }
          : {
              tone: "success",
              message: result || "Portal action completed.",
            }
      setToast(nextToast)
      await refreshAll()
    } catch (error) {
      setToast({ tone: "danger", message: error.message })
    } finally {
      setBusyAction("")
    }
  }

  const reconcilePayouts = () =>
    runAction("reconcile", async () => {
      const result = await request("/portal/payouts/reconcile", { method: "POST" })
      return `Reconciled ${result.checked || 0} payout(s), updated ${result.updated || 0}.`
    })

  const releaseStuckPayouts = () =>
    runAction("release-stuck-payouts", async () => {
      const result = await request("/portal/payouts/release-stuck-pending", { method: "POST" })
      return `Marked ${result.updated || 0} stuck payout(s) failed and released balances.`
    })

  const exportSettlementReport = async () => {
    const actionKey = "export-settlement-report"
    setBusyAction(actionKey)
    setToast(null)

    try {
      const response = await requestFile(
        `/portal/settlements/report?${buildSettlementParams(settlementFilters, false)}`,
        { timeoutMs: 45_000 },
      )

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || "Failed to export settlement report.")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      const filename =
        getFilenameFromDisposition(response.headers.get("Content-Disposition")) ||
        `streamtip-settlements-${new Date().toISOString().slice(0, 10)}.csv`

      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      setToast({ tone: "success", message: "Settlement report exported." })
    } catch (error) {
      setToast({ tone: "danger", message: error.message })
    } finally {
      setBusyAction("")
    }
  }

  const exportDonationReport = async () => {
    const actionKey = "export-donation-report"
    setBusyAction(actionKey)
    setToast(null)

    try {
      const response = await requestFile(
        `/portal/donations/report?${buildDonationParams(donationFilters, false)}`,
        { timeoutMs: 45_000 },
      )

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || "Failed to export gift report.")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      const filename =
        getFilenameFromDisposition(response.headers.get("Content-Disposition")) ||
        `streamtip-gifts-${new Date().toISOString().slice(0, 10)}.csv`

      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      setToast({ tone: "success", message: "Gift report exported." })
    } catch (error) {
      setToast({ tone: "danger", message: error.message })
    } finally {
      setBusyAction("")
    }
  }

  const exportComplianceReport = async () => {
    const actionKey = "export-compliance-report"
    setBusyAction(actionKey)
    setToast(null)

    try {
      const response = await requestFile(
        `/portal/compliance-inflows/report?${buildComplianceParams(complianceFilters, false)}`,
        { timeoutMs: 45_000 },
      )

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || "Failed to export compliance report.")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = getFilenameFromDisposition(response.headers.get("Content-Disposition")) || "streamtip-compliance-inflows.csv"
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      setToast({ tone: "success", message: "Compliance report exported." })
    } catch (error) {
      setToast({ tone: "danger", message: error.message })
    } finally {
      setBusyAction("")
    }
  }

  const openDonation = async (donation) => {
    const donationId = String(donation?.id || "")
    if (!donationId) return

    const actionKey = `load-donation-${donationId}`
    setSelectedDonationId(donationId)
    setSelectedDonationDetails({ donation })
    setBusyAction(actionKey)
    setToast(null)

    try {
      const payload = await request(`/portal/donations/${donationId}`)
      setSelectedDonationDetails(payload)
    } catch (error) {
      setToast({ tone: "danger", message: error.message })
    } finally {
      setBusyAction((current) => (current === actionKey ? "" : current))
    }
  }

  const seedComplianceEdit = (inflow) => {
    if (!inflow?.id) return

    setComplianceEdits((current) => ({
      ...current,
      [inflow.id]: {
        status: inflow.status || "held",
        adminNotes: inflow.adminNotes || "",
        linkedCreatorId: inflow.linkedCreatorId || "",
      },
    }))
  }

  const openComplianceInflow = async (inflow) => {
    const inflowId = String(inflow?.id || "")
    if (!inflowId) return

    const actionKey = `load-compliance-${inflowId}`
    setSelectedComplianceInflowId(inflowId)
    setSelectedComplianceInflowDetails({ inflow })
    seedComplianceEdit(inflow)
    setBusyAction(actionKey)
    setToast(null)

    try {
      const payload = await request(`/portal/compliance-inflows/${inflowId}`)
      setSelectedComplianceInflowDetails(payload)
      seedComplianceEdit(payload?.inflow)
    } catch (error) {
      setToast({ tone: "danger", message: error.message })
    } finally {
      setBusyAction((current) => (current === actionKey ? "" : current))
    }
  }

  const openUser = async (user) => {
    const userId = String(user?.id || "")
    if (!userId) return

    const actionKey = `load-user-${userId}`
    setSelectedUserId(userId)
    setSelectedUserDetails({ user, payouts: [], donations: [], changeRequests: [] })
    setBusyAction(actionKey)
    setToast(null)

    try {
      const payload = await request(`/portal/users/${userId}`)
      setSelectedUserDetails(payload)
    } catch (error) {
      setToast({ tone: "danger", message: error.message })
    } finally {
      setBusyAction((current) => (current === actionKey ? "" : current))
    }
  }

  if (!authChecked) {
    return <BootScreen />
  }

  if (!admin) {
    return (
      <LoginView
        busy={busyAction === "login"}
        toast={toast}
        onLogin={handleLogin}
        onClearToast={() => setToast(null)}
      />
    )
  }

  return (
    <div className="portal-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={22} />
          </div>
          <div>
            <p>StreamTip</p>
            <span>Settlement Portal</span>
          </div>
        </div>

        <nav className="nav-list">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            const count =
              tab.id === "settlements"
                ? settlementQueuePagination.total
                : tab.id === "gifts"
                  ? donationsPagination.total
                : tab.id === "compliance"
                  ? compliancePagination.total
                : tab.id === "kyc-upgrades"
                  ? kycUpgradeSubmissions.filter((item) => item.status === "awaiting_review").length
                : tab.id === "changes"
                  ? changeRequests.filter((item) => item.status === "awaiting_review").length
                  : usersPagination.total

            return (
              <button
                key={tab.id}
                type="button"
                className={isActive ? "nav-item active" : "nav-item"}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
                <strong>{count}</strong>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <span>{admin.email}</span>
          <button type="button" className="icon-button" onClick={handleLogout} title="Log out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Live Operations</p>
            <h1>{tabs.find((tab) => tab.id === activeTab)?.label}</h1>
          </div>
          <div className="topbar-actions">
            <button type="button" className="button ghost" onClick={refreshAll} disabled={loading}>
              <RefreshCcw size={17} />
              Refresh
            </button>
            <button
              type="button"
              className="button primary"
              onClick={reconcilePayouts}
              disabled={busyAction === "reconcile"}
            >
              <DownloadCloud size={17} />
              Reconcile
            </button>
            <button
              type="button"
              className="button danger"
              onClick={releaseStuckPayouts}
              disabled={busyAction === "release-stuck-payouts"}
            >
              <AlertTriangle size={17} />
              Release Stuck
            </button>
          </div>
        </header>

        {toast ? <Toast tone={toast.tone} message={toast.message} onDismiss={() => setToast(null)} /> : null}

        <section className="metrics-grid">
          {metrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </section>

        {activeTab === "settlements" ? (
          <SettlementsView
            payouts={settlements}
            queuePagination={settlementQueuePagination}
            queueFilters={settlementQueueFilters}
            settlementTransferProvider={settlementTransferProvider}
            selectedPayout={selectedSettlement}
            history={settlementHistory}
            historyPagination={settlementHistoryPagination}
            filters={settlementFilters}
            busyAction={busyAction}
            reasons={settlementReasons}
            onReasonChange={(id, value) =>
              setSettlementReasons((current) => ({ ...current, [id]: value }))
            }
            otps={settlementOtps}
            onOtpChange={(id, value) =>
              setSettlementOtps((current) => ({ ...current, [id]: value }))
            }
            onQueueFilterChange={(field, value) =>
              setSettlementQueueFilters((current) => ({ ...current, [field]: value }))
            }
            onQueueSearch={() => loadSettlementQueue({ page: 1 })}
            onQueuePageChange={(page) => loadSettlementQueue({ page })}
            onSelectPayout={(payout) => setSelectedSettlementId(payout?.id || "")}
            onHistoryFilterChange={(field, value) =>
              setSettlementFilters((current) => ({ ...current, [field]: value }))
            }
            onPullReport={() => loadSettlementHistory({ page: 1 })}
            onHistoryPageChange={(page) => loadSettlementHistory({ page })}
            onExportReport={exportSettlementReport}
            onApprove={(id) =>
              runAction(`approve-settlement-${id}`, async () => {
                await request(`/portal/settlements/${id}/approve`, { method: "POST" })
                return "Settlement approved and transfer submitted."
              })
            }
            onAuthorize={(id) =>
              runAction(`authorize-settlement-${id}`, async () => {
                await request(`/portal/settlements/${id}/authorize`, {
                  method: "POST",
                  body: JSON.stringify({ authorizationCode: settlementOtps[id] || "" }),
                })
                setSettlementOtps((current) => ({ ...current, [id]: "" }))
                return "Transfer authorization submitted."
              })
            }
            onResendOtp={(id) =>
              runAction(`resend-settlement-otp-${id}`, async () => {
                await request(`/portal/settlements/${id}/resend-otp`, { method: "POST" })
                return "Transfer OTP resent."
              })
            }
            onRetryTransfer={(id) =>
              runAction(`retry-settlement-${id}`, async () => {
                await request(`/portal/settlements/${id}/retry`, { method: "POST" })
                setSettlementOtps((current) => ({ ...current, [id]: "" }))
                return "Transfer retried with a new provider reference."
              })
            }
            onCancelAndReturn={(id) =>
              runAction(`cancel-return-payout-${id}`, async () => {
                const confirmed = window.confirm(
                  "Cancel this payout and return the reserved balance to the creator dashboard?",
                )

                if (!confirmed) {
                  return "Cancellation skipped."
                }

                await request(`/portal/payouts/${id}/cancel`, {
                  method: "POST",
                  body: JSON.stringify({
                    confirmCancel: true,
                    reason:
                      "Cancelled and returned to creator dashboard balance. Original transfer will not be retried.",
                  }),
                })

                return "Payout cancelled and returned to the creator dashboard balance."
              })
            }
            onReject={(id) =>
              runAction(`reject-settlement-${id}`, async () => {
                await request(`/portal/settlements/${id}/reject`, {
                  method: "POST",
                  body: JSON.stringify({ reason: settlementReasons[id] || "" }),
                })
                return "Settlement rejected before transfer."
              })
            }
          />
        ) : null}

        {activeTab === "gifts" ? (
          <DonationsView
            donations={donations}
            pagination={donationsPagination}
            filters={donationFilters}
            selectedDonation={selectedDonation}
            busyAction={busyAction}
            onFilterChange={(field, value) =>
              setDonationFilters((current) => ({ ...current, [field]: value }))
            }
            onSearch={() => loadDonations({ page: 1 })}
            onPageChange={(page) => loadDonations({ page })}
            onSelectDonation={openDonation}
            onExportReport={exportDonationReport}
            onSyncDonation={(donation) =>
              runAction(`sync-donation-${donation.id}`, async () => {
                const payload = await request(`/portal/donations/${donation.id}/sync-provider`, {
                  method: "POST",
                })

                setSelectedDonationDetails(payload)
                setDonations((current) =>
                  current.map((item) => (item.id === donation.id ? payload.donation : item)),
                )

                return "Gift refreshed from provider."
              })
            }
            onApproveReview={(donation) =>
              runAction(`approve-donation-${donation.id}`, async () => {
                const payload = await request(`/portal/donations/${donation.id}/approve-review`, {
                  method: "POST",
                })
                setSelectedDonationDetails(payload)
                setDonations((current) =>
                  current.map((item) => (item.id === donation.id ? payload.donation : item)),
                )
                return "Risk review approved. Final available earnings still depend on confirmed settlement."
              })
            }
            onRejectReview={(donation) =>
              runAction(`reject-donation-${donation.id}`, async () => {
                const reason = window.prompt("Why should this gift be rejected?") || ""
                if (!reason.trim()) {
                  throw new Error("A rejection reason is required.")
                }

                const payload = await request(`/portal/donations/${donation.id}/reject-review`, {
                  method: "POST",
                  body: JSON.stringify({ reason }),
                })
                setSelectedDonationDetails(payload)
                setDonations((current) =>
                  current.map((item) => (item.id === donation.id ? payload.donation : item)),
                )
                return "Gift rejected and pending balance released."
              })
            }
            onCopyReceipt={(donation) => {
              navigator.clipboard?.writeText(buildDonationReceiptText(donation))
              setToast({ tone: "success", message: "Gift receipt summary copied." })
            }}
          />
        ) : null}

        {activeTab === "compliance" ? (
          <ComplianceInflowsView
            inflows={complianceInflows}
            pagination={compliancePagination}
            filters={complianceFilters}
            selectedInflow={selectedComplianceInflow}
            busyAction={busyAction}
            edits={complianceEdits}
            users={users}
            onFilterChange={(field, value) =>
              setComplianceFilters((current) => ({ ...current, [field]: value }))
            }
            onSearch={() => loadComplianceInflows({ page: 1 })}
            onPageChange={(page) => loadComplianceInflows({ page })}
            onSelectInflow={openComplianceInflow}
            onExportReport={exportComplianceReport}
            onEditChange={(id, field, value) =>
              setComplianceEdits((current) => ({
                ...current,
                [id]: {
                  status: selectedComplianceInflow?.status || "held",
                  adminNotes: selectedComplianceInflow?.adminNotes || "",
                  linkedCreatorId: selectedComplianceInflow?.linkedCreatorId || "",
                  ...(current[id] || {}),
                  [field]: value,
                },
              }))
            }
            onSaveInflow={(inflow) =>
              runAction(`save-compliance-${inflow.id}`, async () => {
                const edit = complianceEdits[inflow.id] || {}
                const payload = await request(`/portal/compliance-inflows/${inflow.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    status: edit.status || inflow.status || "held",
                    adminNotes: edit.adminNotes || "",
                    linkedCreatorId: edit.linkedCreatorId || "",
                  }),
                })

                setSelectedComplianceInflowDetails(payload)
                seedComplianceEdit(payload?.inflow)
                setComplianceInflows((current) =>
                  current.map((item) => (item.id === inflow.id ? payload.inflow : item)),
                )

                return "Compliance inflow updated."
              })
            }
            onCopySummary={(inflow) => {
              navigator.clipboard?.writeText(buildComplianceInflowSummary(inflow))
              setToast({ tone: "success", message: "Compliance inflow summary copied." })
            }}
          />
        ) : null}

        {activeTab === "kyc-upgrades" ? (
          <KycUpgradesView
            submissions={kycUpgradeSubmissions}
            pagination={kycUpgradePagination}
            filters={kycUpgradeFilters}
            selectedSubmission={selectedKycUpgradeSubmission}
            busyAction={busyAction}
            onFilterChange={(field, value) =>
              setKycUpgradeFilters((current) => ({ ...current, [field]: value }))
            }
            onSearch={() => loadKycUpgradeSubmissions({ page: 1 })}
            onPageChange={(page) => loadKycUpgradeSubmissions({ page })}
            onSelectSubmission={(submission) => setSelectedKycUpgradeId(submission?.id || "")}
            onApproveSubmission={(submission) =>
              runAction(`approve-kyc-upgrade-${submission.id}`, async () => {
                await request(`/portal/kyc-upgrade-submissions/${submission.id}/approve`, {
                  method: "POST",
                })
                return `Tier ${submission.targetTier} upgrade approved for ${submission.creatorEmail || submission.creator?.email || "creator"}.`
              })
            }
            onRejectSubmission={(submission) =>
              runAction(`reject-kyc-upgrade-${submission.id}`, async () => {
                const rejectionReason = window.prompt("Enter rejection reason") || ""
                if (!rejectionReason.trim()) {
                  throw new Error("A rejection reason is required.")
                }

                await request(`/portal/kyc-upgrade-submissions/${submission.id}/reject`, {
                  method: "POST",
                  body: JSON.stringify({ rejectionReason }),
                })
                return "KYC upgrade submission rejected."
              })
            }
          />
        ) : null}

        {activeTab === "changes" ? (
          <ChangeRequestsView
            requests={changeRequests}
            busyAction={busyAction}
            cooldowns={cooldowns}
            reasons={changeReasons}
            onCooldownChange={(id, value) =>
              setCooldowns((current) => ({ ...current, [id]: value }))
            }
            onReasonChange={(id, value) =>
              setChangeReasons((current) => ({ ...current, [id]: value }))
            }
            onApprove={(id) =>
              runAction(`approve-change-${id}`, async () => {
                await request(`/portal/payout-profile-change-requests/${id}/approve`, {
                  method: "POST",
                  body: JSON.stringify({ cooldownHours: Number(cooldowns[id] || 48) }),
                })
                return "Payout profile change approved."
              })
            }
            onReject={(id) =>
              runAction(`reject-change-${id}`, async () => {
                await request(`/portal/payout-profile-change-requests/${id}/reject`, {
                  method: "POST",
                  body: JSON.stringify({ reason: changeReasons[id] || "" }),
                })
                return "Payout profile change rejected."
              })
            }
          />
        ) : null}

        {activeTab === "users" ? (
          <UsersView
            users={users}
            pagination={usersPagination}
            search={userSearch}
            selectedUser={selectedUser}
            selectedUserDetails={selectedUserDetails}
            edits={userEdits}
            busyAction={busyAction}
            onSearchChange={setUserSearch}
            onSearchSubmit={() => loadUsers({ search: userSearch, page: 1 })}
            onPageChange={(page) => loadUsers({ page })}
            onOpenUser={openUser}
            onEditChange={(id, field, value) =>
              setUserEdits((current) => ({
                ...current,
                [id]: {
                  ...(current[id] || {}),
                  [field]: value,
                },
              }))
            }
            onSaveUser={(user) =>
              runAction(`save-user-${user.id}`, async () => {
                const edit = userEdits[user.id] || {}
                const payload = await request(`/portal/users/${user.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    name: edit.name ?? user.name,
                    email: edit.email ?? user.email,
                    phoneNumber: edit.phoneNumber ?? user.phoneNumber ?? "",
                    status: edit.status ?? user.status ?? "active",
                    kycTier: Number(edit.kycTier ?? user.kyc?.tier ?? user.kycTier ?? 1),
                    kycStatus: edit.kycStatus ?? user.kyc?.status ?? user.kycStatus ?? "incomplete",
                    phoneVerified: Boolean(edit.phoneVerified ?? user.phoneVerified ?? user.kyc?.phoneVerified),
                    bvnVerified: Boolean(edit.bvnVerified ?? user.kyc?.bvnVerified),
                    ninVerified: Boolean(edit.ninVerified ?? user.kyc?.ninVerified),
                    selfieVerified: Boolean(edit.selfieVerified ?? user.kyc?.selfieVerified),
                    bankAccountMatched: Boolean(edit.bankAccountMatched ?? user.kyc?.bankAccountMatched),
                    proofOfAddressSubmitted: Boolean(edit.proofOfAddressSubmitted ?? user.kyc?.proofOfAddressSubmitted),
                    bankStatementSubmitted: Boolean(edit.bankStatementSubmitted ?? user.kyc?.bankStatementSubmitted),
                    socialMediaVerified: Boolean(edit.socialMediaVerified ?? user.kyc?.socialMediaVerified),
                    manualReviewStatus:
                      edit.manualReviewStatus ?? user.kyc?.manualReviewStatus ?? "not_required",
                    dailyReceivingLimitOverride: Number(edit.dailyReceivingLimitOverride || 0),
                    reason: edit.reason || "",
                    identity: {
                      firstName: edit.firstName ?? user.identity?.firstName ?? user.firstName ?? "",
                      middleName: edit.middleName ?? user.identity?.middleName ?? user.middleName ?? "",
                      lastName: edit.lastName ?? user.identity?.lastName ?? user.lastName ?? "",
                      dateOfBirth: edit.dateOfBirth ?? user.identity?.dateOfBirth ?? "",
                    },
                  }),
                })
                const refreshed = await request(`/portal/users/${user.id}`)

                setSelectedUserDetails((current) =>
                  current?.user?.id === user.id ? refreshed : current,
                )
                setUsers((current) =>
                  current.map((item) => (item.id === user.id ? refreshed.user || payload.user : item)),
                )
                setUserEdits((current) => {
                  const next = { ...current }
                  delete next[user.id]
                  return next
                })

                return "Creator record updated."
              })
            }
            onRequeryPaystack={(user) =>
              runAction(`requery-paystack-${user.id}`, async () => {
                const defaultDate = new Date().toISOString().slice(0, 10)
                const date = window.prompt("Paystack requery date (YYYY-MM-DD)", defaultDate) || ""
                const trimmedDate = date.trim()

                if (trimmedDate && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
                  throw new Error("Enter date as YYYY-MM-DD.")
                }

                const payload = await request(`/portal/users/${user.id}/paystack-requery`, {
                  method: "POST",
                  body: JSON.stringify({ date: trimmedDate }),
                })

                return payload?.message || "Paystack requery requested."
              })
            }
            onVerifyIdentity={(user, type) =>
              runAction(`verify-identity-${type}-${user.id}`, async () => {
                const payload = await request(`/portal/users/${user.id}/identity-verification`, {
                  method: "POST",
                  body: JSON.stringify({ type, force: true }),
                })
                const refreshed = await request(`/portal/users/${user.id}`)

                setSelectedUserDetails((current) =>
                  current?.user?.id === user.id ? refreshed : current,
                )
                setUsers((current) =>
                  current.map((item) => (item.id === user.id ? refreshed.user || payload.user : item)),
                )

                return buildVerificationToast(payload, type)
              })
            }
          />
        ) : null}
      </main>
    </div>
  )
}

function BootScreen() {
  return (
    <div className="boot-screen">
      <div className="loader" />
    </div>
  )
}

function LoginView({ busy, toast, onLogin, onClearToast }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const submit = (event) => {
    event.preventDefault()
    onLogin({ email, password })
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark">
          <ShieldCheck size={28} />
        </div>
        <div>
          <p className="eyebrow">StreamTip Portal</p>
          <h1>Admin Sign In</h1>
        </div>
        {toast ? <Toast tone={toast.tone} message={toast.message} onDismiss={onClearToast} compact /> : null}
        <label>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit" className="button primary full" disabled={busy}>
          <ShieldCheck size={17} />
          {busy ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </main>
  )
}

function Toast({ tone, message, onDismiss, compact = false }) {
  return (
    <div className={`toast ${tone} ${compact ? "compact" : ""}`}>
      <span>{tone === "danger" ? <AlertTriangle size={18} /> : <BadgeCheck size={18} />}</span>
      <p>{message}</p>
      <button type="button" onClick={onDismiss} title="Dismiss">
        <X size={16} />
      </button>
    </div>
  )
}

function MetricCard({ label, value, icon: Icon, tone }) {
  return (
    <article className={`metric-card ${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <Icon size={22} />
    </article>
  )
}

function SettlementsView({
  payouts,
  queuePagination,
  queueFilters,
  settlementTransferProvider,
  selectedPayout,
  history,
  historyPagination,
  filters,
  busyAction,
  reasons,
  otps,
  onReasonChange,
  onOtpChange,
  onQueueFilterChange,
  onQueueSearch,
  onQueuePageChange,
  onSelectPayout,
  onHistoryFilterChange,
  onPullReport,
  onHistoryPageChange,
  onExportReport,
  onApprove,
  onAuthorize,
  onResendOtp,
  onRetryTransfer,
  onCancelAndReturn,
  onReject,
}) {
  return (
    <section className="settlements-stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Settlement Queue</p>
          <h2>Withdrawals Waiting For Action</h2>
        </div>
        <div className="heading-meta-stack">
          <span>{queuePagination.total} open</span>
          <span className="provider-indicator">
            Provider: {formatPayoutProviderLabel(settlementTransferProvider)}
          </span>
        </div>
      </div>

      <section className="queue-panel">
        <div className="panel-toolbar report-toolbar">
          <div className="searchbox">
            <Search size={17} />
            <input
              value={queueFilters.search}
              onChange={(event) => onQueueFilterChange("search", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onQueueSearch()
              }}
              placeholder="Search email, name, bank or reference"
            />
          </div>
          <button type="button" className="button primary" onClick={onQueueSearch}>
            <Search size={17} />
            Search
          </button>
        </div>

        <div className="queue-layout">
          <div className="queue-table-panel">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Requested</th>
                    <th>Creator</th>
                    <th>Email</th>
                    <th>Amount</th>
                    <th>Bank</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th>Transfer Ref</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.length ? (
                    payouts.map((payout) => (
                      <tr
                        key={payout.id}
                        className={
                          String(selectedPayout?.id || "") === String(payout.id)
                            ? "clickable selected"
                            : "clickable"
                        }
                        onClick={() => onSelectPayout(payout)}
                      >
                        <td>{formatDate(payout.createdAt)}</td>
                        <td>{payout.creator?.name || "Unknown"}</td>
                        <td>{payout.creator?.email || "Not available"}</td>
                        <td>{formatCurrency(payout.amount)}</td>
                        <td>{payout.bankName || "Not available"}</td>
                        <td>
                          <StatusPill
                            status={
                              payout.requiresAuthorization
                                ? "pending_authorization"
                                : payout.canRetryTransfer
                                  ? "retry_ready"
                                  : payout.status
                            }
                          />
                        </td>
                        <td>{formatPayoutProviderLabel(payout.provider || settlementTransferProvider)}</td>
                        <td>{payout.transferReference || "Not sent"}</td>
                        <td>
                          {payout.canCancelAndReturn ? (
                            <button
                              type="button"
                              className="button danger compact"
                              disabled={busyAction === `cancel-return-payout-${payout.id}`}
                              onClick={(event) => {
                                event.stopPropagation()
                                onCancelAndReturn(payout.id)
                              }}
                            >
                              <RotateCcw size={15} />
                              Return
                            </button>
                          ) : (
                            <span className="muted-text">No action</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="9" className="empty-cell">
                        No settlement waiting for review
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <PaginationControls pagination={queuePagination} onPageChange={onQueuePageChange} />
          </div>

          {selectedPayout ? (
            <SettlementQueueCard
              payout={selectedPayout}
              busyAction={busyAction}
              reason={reasons[selectedPayout.id] || ""}
              otp={otps[selectedPayout.id] || ""}
              onReasonChange={onReasonChange}
              onOtpChange={onOtpChange}
              onApprove={onApprove}
              onAuthorize={onAuthorize}
              onResendOtp={onResendOtp}
              onRetryTransfer={onRetryTransfer}
              onCancelAndReturn={onCancelAndReturn}
              onReject={onReject}
            />
          ) : (
            <EmptyState icon={CircleDollarSign} title="Select a withdrawal to review" compact />
          )}
        </div>
      </section>

      <section className="history-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Settlement History</p>
            <h2>Withdrawal Report</h2>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="button ghost"
              onClick={onPullReport}
              disabled={busyAction === "pull-settlement-report"}
            >
              <RefreshCcw size={17} />
              Pull Report
            </button>
            <button
              type="button"
              className="button primary"
              onClick={onExportReport}
              disabled={busyAction === "export-settlement-report"}
            >
              <DownloadCloud size={17} />
              Export Excel
            </button>
          </div>
        </div>

        <div className="panel-toolbar report-toolbar">
          <div className="searchbox">
            <Search size={17} />
            <input
              value={filters.search}
              onChange={(event) => onHistoryFilterChange("search", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onPullReport()
              }}
              placeholder="Search email, name, bank or reference"
            />
          </div>
          <select
            value={filters.status}
            onChange={(event) => onHistoryFilterChange("status", event.target.value)}
          >
            {settlementStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Requested</th>
                <th>Creator</th>
                <th>Email</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Review</th>
                <th>Provider</th>
                <th>Transfer Ref</th>
                <th>Reviewed</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {history.length ? (
                history.map((payout) => (
                  <tr key={payout.id}>
                    <td>{formatDate(payout.createdAt)}</td>
                    <td>{payout.creator?.name || "Unknown"}</td>
                    <td>{payout.creator?.email || "Not available"}</td>
                    <td>{formatCurrency(payout.amount)}</td>
                    <td>
                      <StatusPill status={payout.status} />
                    </td>
                    <td>
                      <StatusPill status={payout.reviewStatus || "not_required"} />
                    </td>
                    <td>{formatPayoutProviderLabel(payout.provider || settlementTransferProvider)}</td>
                    <td>{payout.transferReference || "Not sent"}</td>
                    <td>{formatDate(payout.reviewedAt || payout.completedAt)}</td>
                    <td>
                      {payout.canCancelAndReturn ? (
                        <button
                          type="button"
                          className="button danger compact"
                          disabled={busyAction === `cancel-return-payout-${payout.id}`}
                          onClick={() => onCancelAndReturn(payout.id)}
                        >
                          <RotateCcw size={15} />
                          Return
                        </button>
                      ) : (
                        <span className="muted-text">No action</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="10" className="empty-cell">
                    No settlement history found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <PaginationControls pagination={historyPagination} onPageChange={onHistoryPageChange} />
      </section>
    </section>
  )
}

function DonationsView({
  donations,
  pagination,
  filters,
  selectedDonation,
  busyAction,
  onFilterChange,
  onSearch,
  onPageChange,
  onSelectDonation,
  onExportReport,
  onSyncDonation,
  onApproveReview,
  onRejectReview,
  onCopyReceipt,
}) {
  return (
    <section className="settlements-stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Gift Ledger</p>
          <h2>Virtual Account Inflows</h2>
        </div>
        <span>{pagination.total} records</span>
      </div>

      <section className="queue-panel">
        <div className="panel-toolbar report-toolbar">
          <div className="searchbox">
            <Search size={17} />
            <input
              value={filters.search}
              onChange={(event) => onFilterChange("search", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSearch()
              }}
              placeholder="Search source, streamer, VA, session ID or reference"
            />
          </div>
          <div className="topbar-actions">
            <input
              type="date"
              value={filters.from || ""}
              onChange={(event) => onFilterChange("from", event.target.value)}
              title="From date"
            />
            <input
              type="date"
              value={filters.to || ""}
              onChange={(event) => onFilterChange("to", event.target.value)}
              title="To date"
            />
            <button type="button" className="button primary" onClick={onSearch}>
              <Search size={17} />
              Search
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={onExportReport}
              disabled={busyAction === "export-donation-report"}
            >
              <DownloadCloud size={17} />
              Export CSV
            </button>
          </div>
        </div>

        <div className="queue-layout">
          <div className="queue-table-panel">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Streamer</th>
                    <th>Amount</th>
                    <th>Source Name</th>
                    <th>Source Account</th>
                    <th>Session ID</th>
                    <th>Alert Name</th>
                    <th>Virtual Account</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {donations.length ? (
                    donations.map((donation) => (
                      <tr
                        key={donation.id}
                        className={
                          String(selectedDonation?.id || "") === String(donation.id)
                            ? "clickable selected"
                            : "clickable"
                        }
                        onClick={() => onSelectDonation(donation)}
                      >
                        <td>{formatDate(donation.date)}</td>
                        <td>{donation.creator?.name || donation.creatorEmail || "Unknown"}</td>
                        <td>{formatCurrency(donation.amount)}</td>
                        <td>{donation.sourceAccountName || "Not synced"}</td>
                        <td>{formatSourceAccountNumber(donation.sourceAccountNumber)}</td>
                        <td>{donation.sourceSessionId || "Not synced"}</td>
                        <td>{donation.sender || "Anonymous"}</td>
                        <td>{donation.destinationAccountNumber || "Not available"}</td>
                        <td>
                          {donation.transactionReference ||
                            donation.paystackReference ||
                            donation.monnifyTransactionReference ||
                            donation.monnifyPaymentReference ||
                            "No ref"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="9" className="empty-cell">
                        No gift inflow found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <PaginationControls pagination={pagination} onPageChange={onPageChange} />
          </div>

          {selectedDonation ? (
            <DonationDetailCard
              donation={selectedDonation}
              loading={busyAction === `load-donation-${selectedDonation.id}`}
              syncing={busyAction === `sync-donation-${selectedDonation.id}`}
              reviewing={
                busyAction === `approve-donation-${selectedDonation.id}` ||
                busyAction === `reject-donation-${selectedDonation.id}`
              }
              onSyncDonation={onSyncDonation}
              onApproveReview={onApproveReview}
              onRejectReview={onRejectReview}
              onCopyReceipt={onCopyReceipt}
            />
          ) : (
            <EmptyState icon={FileText} title="Select a gift transaction" compact />
          )}
        </div>
      </section>
    </section>
  )
}

function DonationDetailCard({
  donation,
  loading,
  syncing,
  reviewing,
  onSyncDonation,
  onApproveReview,
  onRejectReview,
  onCopyReceipt,
}) {
  const provider = donation.provider || "monnify"
  const canSyncProvider = provider === "monnify"
  const isPendingReview = donation.walletStatus === "pending_review"

  return (
    <article className="work-card">
      <div className="card-head">
        <div>
          <p className="eyebrow">{donation.creatorEmail || donation.creator?.email || "Creator"}</p>
          <h2>{formatCurrency(donation.amount)}</h2>
        </div>
        <StatusPill status={donation.paymentStatus || "paid"} />
      </div>

      {loading ? <p className="notice">Loading provider payload...</p> : null}
      {canSyncProvider && (!donation.sourceAccountName || !donation.sourceSessionId) ? (
        <p className="notice">
          Source details are missing on this saved row. Refresh from provider to backfill the full source name,
          masked account number, and session ID when it is still available.
        </p>
      ) : null}
      {String(donation.sourceAccountNumber || "").includes("*") ? (
        <p className="notice">
          The provider returned a masked sender account number. Use the source session ID or provider dashboard
          when compliance requires the complete account.
        </p>
      ) : null}
      {isPendingReview ? (
        <p className="notice warning">
          This gift is held for risk/compliance review. Settlement confirmation still controls available earnings.
        </p>
      ) : null}

      <div className="detail-grid">
        <Detail label="Received" value={formatDate(donation.date)} />
        <Detail label="Provider Paid" value={formatDate(donation.paidOn)} />
        <Detail label="Provider" value={provider} />
        <Detail label="Wallet Status" value={donation.walletStatus || "available"} />
        <Detail label="Settlement Status" value={donation.settlementStatus || "pending"} />
        <Detail label="Settled (Creator)" value={formatCurrency(donation.creatorSettledAmount || 0)} />
        <Detail label="Pending Settlement" value={formatCurrency(donation.settlementPendingAmount || 0)} />
        <Detail label="Streamer" value={donation.creator?.name || donation.creatorEmail || "Unknown"} />
        <Detail label="Destination VA" value={`${donation.destinationAccountNumber || "No account"} - ${donation.destinationBankName || "No bank"}`} />
        <Detail label="Source Name" value={donation.sourceAccountName || "Not synced"} />
        <Detail label="Source Account" value={formatSourceAccountNumber(donation.sourceAccountNumber)} />
        <Detail label="Source Bank" value={donation.sourceBankName || "Not available"} />
        <Detail label="Source Session ID" value={donation.sourceSessionId || "Not synced"} />
        <Detail label="Streamer Alert Name" value={donation.sender || "Anonymous"} />
        <Detail label="Transaction Ref" value={donation.transactionReference || donation.monnifyTransactionReference || donation.paystackReference || "Not available"} wide />
        <Detail label="Payment Ref" value={donation.monnifyPaymentReference || donation.paystackReference || "Not available"} wide />
        <Detail label="Risk Flags" value={(donation.riskFlags || []).join(", ") || "None"} wide />
        <Detail label="Risk Reason" value={donation.riskReason || "None"} wide />
      </div>

      <div className="action-row split">
        {canSyncProvider ? (
          <button
            type="button"
            className="button primary"
            onClick={() => onSyncDonation(donation)}
            disabled={syncing}
          >
            <RefreshCcw size={17} />
            Refresh From Provider
          </button>
        ) : null}
        {isPendingReview ? (
          <>
            <button
              type="button"
              className="button success"
              onClick={() => onApproveReview(donation)}
              disabled={reviewing}
            >
              <Check size={17} />
              Approve Wallet Credit
            </button>
            <button
              type="button"
              className="button danger"
              onClick={() => onRejectReview(donation)}
              disabled={reviewing}
            >
              <X size={17} />
              Reject Gift
            </button>
          </>
        ) : null}
        <button type="button" className="button ghost" onClick={() => onCopyReceipt(donation)}>
          <Copy size={17} />
          Copy Receipt Summary
        </button>
      </div>

      {donation.providerPayload ? (
        <div className="detail-section">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Provider Payload</p>
              <h2>Raw Provider Event</h2>
            </div>
          </div>
          <pre className="json-box">{JSON.stringify(donation.providerPayload, null, 2)}</pre>
        </div>
      ) : null}
    </article>
  )
}

function ComplianceInflowsView({
  inflows,
  pagination,
  filters,
  selectedInflow,
  busyAction,
  edits,
  users,
  onFilterChange,
  onSearch,
  onPageChange,
  onSelectInflow,
  onExportReport,
  onEditChange,
  onSaveInflow,
  onCopySummary,
}) {
  return (
    <section className="settlements-stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Suspense Ledger</p>
          <h2>Compliance Inflows</h2>
        </div>
        <span>{pagination.total} records</span>
      </div>

      <section className="queue-panel">
        <div className="panel-toolbar report-toolbar">
          <div className="searchbox">
            <Search size={17} />
            <input
              value={filters.search}
              onChange={(event) => onFilterChange("search", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSearch()
              }}
              placeholder="Search source, VA, session ID, reference or notes"
            />
          </div>
          <div className="topbar-actions">
            <select
              value={filters.status || "all"}
              onChange={(event) => onFilterChange("status", event.target.value)}
              title="Status"
            >
              {complianceStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={filters.from || ""}
              onChange={(event) => onFilterChange("from", event.target.value)}
              title="From date"
            />
            <input
              type="date"
              value={filters.to || ""}
              onChange={(event) => onFilterChange("to", event.target.value)}
              title="To date"
            />
            <button type="button" className="button primary" onClick={onSearch}>
              <Search size={17} />
              Search
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={onExportReport}
              disabled={busyAction === "export-compliance-report"}
            >
              <DownloadCloud size={17} />
              Export CSV
            </button>
          </div>
        </div>

        <div className="queue-layout">
          <div className="queue-table-panel">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Source Name</th>
                    <th>Source Account</th>
                    <th>Session ID</th>
                    <th>Virtual Account</th>
                    <th>Linked Creator</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {inflows.length ? (
                    inflows.map((inflow) => (
                      <tr
                        key={inflow.id}
                        className={
                          String(selectedInflow?.id || "") === String(inflow.id)
                            ? "clickable selected"
                            : "clickable"
                        }
                        onClick={() => onSelectInflow(inflow)}
                      >
                        <td>{formatDate(inflow.date)}</td>
                        <td><StatusPill status={inflow.status || "held"} /></td>
                        <td>{formatCurrency(inflow.amount)}</td>
                        <td>{inflow.sourceAccountName || "Not stored"}</td>
                        <td>{formatSourceAccountNumber(inflow.sourceAccountNumber)}</td>
                        <td>{inflow.sourceSessionId || "Not stored"}</td>
                        <td>{inflow.destinationAccountNumber || "Missing"}</td>
                        <td>{inflow.linkedCreator?.name || inflow.linkedCreatorEmail || "Not linked"}</td>
                        <td>
                          {inflow.transactionReference ||
                            inflow.paystackReference ||
                            inflow.monnifyTransactionReference ||
                            inflow.monnifyPaymentReference ||
                            "No ref"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="9" className="empty-cell">
                        No compliance inflow found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <PaginationControls pagination={pagination} onPageChange={onPageChange} />
          </div>

          {selectedInflow ? (
            <ComplianceInflowDetailCard
              inflow={selectedInflow}
              loading={busyAction === `load-compliance-${selectedInflow.id}`}
              saving={busyAction === `save-compliance-${selectedInflow.id}`}
              edit={edits[selectedInflow.id] || {}}
              users={users}
              onEditChange={onEditChange}
              onSaveInflow={onSaveInflow}
              onCopySummary={onCopySummary}
            />
          ) : (
            <EmptyState icon={AlertTriangle} title="Select a compliance inflow" compact />
          )}
        </div>
      </section>
    </section>
  )
}

function ComplianceInflowDetailCard({
  inflow,
  loading,
  saving,
  edit,
  users,
  onEditChange,
  onSaveInflow,
  onCopySummary,
}) {
  const statusValue = edit.status || inflow.status || "held"
  const linkedCreatorValue = edit.linkedCreatorId ?? inflow.linkedCreatorId ?? ""

  return (
    <article className="work-card">
      <div className="card-head">
        <div>
          <p className="eyebrow">{inflow.paymentStatus || "Provider inflow"}</p>
          <h2>{formatCurrency(inflow.amount)}</h2>
        </div>
        <StatusPill status={statusValue} />
      </div>

      {loading ? <p className="notice">Loading raw provider payload...</p> : null}
      {inflow.validationReason ? <p className="notice">{inflow.validationReason}</p> : null}

      <div className="detail-grid">
        <Detail label="Date" value={formatDate(inflow.date)} />
        <Detail label="Provider Paid" value={formatDate(inflow.paidOn)} />
        <Detail label="Provider" value={inflow.provider || "Not available"} />
        <Detail label="Source Name" value={inflow.sourceAccountName || "Not stored"} />
        <Detail label="Source Account" value={formatSourceAccountNumber(inflow.sourceAccountNumber)} />
        <Detail label="Source Bank" value={inflow.sourceBankName || "Not available"} />
        <Detail label="Source Session ID" value={inflow.sourceSessionId || "Not stored"} />
        <Detail label="Destination VA" value={`${inflow.destinationAccountNumber || "Missing"} - ${inflow.destinationBankName || "No bank"}`} />
        <Detail label="Reserved Ref" value={inflow.reservedAccountReference || "Not available"} />
        <Detail label="Linked Creator" value={inflow.linkedCreator?.name || inflow.linkedCreatorEmail || "Not linked"} />
        <Detail label="Linked Donation" value={inflow.linkedDonationId || "Not linked"} />
        <Detail label="Transaction Ref" value={inflow.transactionReference || inflow.monnifyTransactionReference || inflow.paystackReference || "Not available"} wide />
        <Detail label="Payment Ref" value={inflow.monnifyPaymentReference || inflow.paystackReference || "Not available"} wide />
        <Detail label="Paystack ID" value={inflow.paystackTransactionId || "Not available"} wide />
      </div>

      <label>
        <span>Status</span>
        <select
          value={statusValue}
          onChange={(event) => onEditChange(inflow.id, "status", event.target.value)}
        >
          {complianceStatusOptions
            .filter((option) => option.value !== "all")
            .map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
        </select>
      </label>

      <label>
        <span>Linked Creator</span>
        <select
          value={linkedCreatorValue}
          onChange={(event) => onEditChange(inflow.id, "linkedCreatorId", event.target.value)}
        >
          <option value="">Not linked</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name || user.email} ({user.email})
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Admin Notes</span>
        <textarea
          value={edit.adminNotes ?? inflow.adminNotes ?? ""}
          onChange={(event) => onEditChange(inflow.id, "adminNotes", event.target.value)}
          placeholder="Admin notes"
        />
      </label>

      <div className="action-row split">
        <button
          type="button"
          className="button primary"
          onClick={() => onSaveInflow(inflow)}
          disabled={saving}
        >
          <Check size={17} />
          Save Validation
        </button>
        <button type="button" className="button ghost" onClick={() => onCopySummary(inflow)}>
          <Copy size={17} />
          Copy Summary
        </button>
      </div>

      {inflow.rawMonnifyPayload || inflow.rawPaystackPayload ? (
        <div className="detail-section">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Provider Payload</p>
              <h2>Raw Provider Inflow</h2>
            </div>
          </div>
          <pre className="json-box">{JSON.stringify(inflow.rawPaystackPayload || inflow.rawMonnifyPayload, null, 2)}</pre>
        </div>
      ) : null}
    </article>
  )
}

function SettlementQueueCard({
  payout,
  busyAction,
  reason,
  otp,
  onReasonChange,
  onOtpChange,
  onApprove,
  onAuthorize,
  onResendOtp,
  onRetryTransfer,
  onCancelAndReturn,
  onReject,
}) {
  const isPendingAuthorization = Boolean(payout.requiresAuthorization)
  const isRetryableTransfer = Boolean(payout.canRetryTransfer)
  const displayStatus = isPendingAuthorization
    ? "pending_authorization"
    : isRetryableTransfer
      ? "retry_ready"
      : payout.reviewStatus || payout.status

  return (
    <article className="work-card">
      <div className="card-head">
        <div>
          <p className="eyebrow">{payout.creator?.email || "Creator"}</p>
          <h2>{formatCurrency(payout.amount)}</h2>
        </div>
        <StatusPill status={displayStatus} />
      </div>

      <div className="detail-grid">
        <Detail label="Creator" value={payout.creator?.name || "Unknown"} />
        <Detail label="Provider" value={payout.provider || "Not available"} />
        <Detail label="Requested" value={formatDate(payout.createdAt)} />
        <Detail label="Bank" value={payout.bankName} />
        <Detail label="Transfer Ref" value={payout.transferReference || "Not sent yet"} />
        <Detail label="Account" value={`${payout.accountName || "No name"} - ${maskAccount(payout.accountNumber)}`} />
        <Detail label="Reason" value={payout.reviewReason || "First withdrawal or limit review"} wide />
      </div>

      {payout.providerMessage ? <p className="notice">{payout.providerMessage}</p> : null}

      {isPendingAuthorization ? (
        <>
          <label>
            <span>Transfer OTP</span>
            <input
              value={otp}
              onChange={(event) => onOtpChange(payout.id, event.target.value)}
              placeholder="Enter authorization code"
              inputMode="numeric"
            />
          </label>

          <div className="action-row">
            <button
              type="button"
              className="button success"
              disabled={busyAction === `authorize-settlement-${payout.id}`}
              onClick={() => onAuthorize(payout.id)}
            >
              <Check size={17} />
              Verify OTP
            </button>
            <button
              type="button"
              className="button ghost"
              disabled={busyAction === `resend-settlement-otp-${payout.id}`}
              onClick={() => onResendOtp(payout.id)}
            >
              <RefreshCcw size={17} />
              Resend OTP
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busyAction === `retry-settlement-${payout.id}`}
              onClick={() => onRetryTransfer(payout.id)}
            >
              <RefreshCcw size={17} />
              Retry Transfer
            </button>
            <button
              type="button"
              className="button danger"
              disabled={busyAction === `cancel-return-payout-${payout.id}`}
              onClick={() => onCancelAndReturn(payout.id)}
            >
              <RotateCcw size={17} />
              Cancel & Return
            </button>
          </div>
        </>
      ) : isRetryableTransfer ? (
        <div className="action-row">
          <button
            type="button"
            className="button primary"
            disabled={busyAction === `retry-settlement-${payout.id}`}
            onClick={() => onRetryTransfer(payout.id)}
          >
            <RefreshCcw size={17} />
            Retry Transfer
          </button>
          <button
            type="button"
            className="button danger"
            disabled={busyAction === `cancel-return-payout-${payout.id}`}
            onClick={() => onCancelAndReturn(payout.id)}
          >
            <RotateCcw size={17} />
            Cancel & Return
          </button>
        </div>
      ) : (
        <>
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(payout.id, event.target.value)}
            placeholder="Rejection note"
          />

          <div className="action-row">
            <button
              type="button"
              className="button success"
              disabled={busyAction === `approve-settlement-${payout.id}`}
              onClick={() => onApprove(payout.id)}
            >
              <Check size={17} />
              Approve & Send
            </button>
            <button
              type="button"
              className="button danger"
              disabled={busyAction === `reject-settlement-${payout.id}`}
              onClick={() => onReject(payout.id)}
            >
              <X size={17} />
              Reject
            </button>
          </div>
        </>
      )}
    </article>
  )
}

function KycUpgradesView({
  submissions,
  pagination,
  filters,
  selectedSubmission,
  busyAction,
  onFilterChange,
  onSearch,
  onPageChange,
  onSelectSubmission,
  onApproveSubmission,
  onRejectSubmission,
}) {
  return (
    <section className="settlements-stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">KYC Upgrade Reviews</p>
          <h2>Tier Upgrade Submissions</h2>
        </div>
        <span>{pagination.total} records</span>
      </div>

      <section className="queue-panel">
        <div className="panel-toolbar report-toolbar">
          <div className="topbar-actions">
            <select
              value={filters.status || "all"}
              onChange={(event) => onFilterChange("status", event.target.value)}
              title="Status"
            >
              {kycUpgradeStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button type="button" className="button primary" onClick={onSearch}>
              <Search size={17} />
              Filter
            </button>
          </div>
        </div>

        <div className="queue-layout">
          <div className="queue-table-panel">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Submitted</th>
                    <th>Creator</th>
                    <th>Current Tier</th>
                    <th>Target Tier</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.length ? (
                    submissions.map((submission) => (
                      <tr
                        key={submission.id}
                        className={
                          String(selectedSubmission?.id || "") === String(submission.id)
                            ? "clickable selected"
                            : "clickable"
                        }
                        onClick={() => onSelectSubmission(submission)}
                      >
                        <td>{formatDate(submission.submittedAt || submission.createdAt)}</td>
                        <td>{submission.creatorEmail || submission.creator?.email || "Not available"}</td>
                        <td>Tier {submission.currentTier || 1}</td>
                        <td>Tier {submission.targetTier || 2}</td>
                        <td>
                          <StatusPill status={submission.status || "awaiting_review"} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5" className="empty-cell">
                        No KYC upgrade submissions found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <PaginationControls pagination={pagination} onPageChange={onPageChange} />
          </div>

          {selectedSubmission ? (
            <KycUpgradeDetailCard
              submission={selectedSubmission}
              approving={busyAction === `approve-kyc-upgrade-${selectedSubmission.id}`}
              rejecting={busyAction === `reject-kyc-upgrade-${selectedSubmission.id}`}
              onApprove={onApproveSubmission}
              onReject={onRejectSubmission}
            />
          ) : (
            <EmptyState icon={ShieldCheck} title="Select a KYC upgrade submission" compact />
          )}
        </div>
      </section>
    </section>
  )
}

function KycUpgradeDetailCard({ submission, approving, rejecting, onApprove, onReject }) {
  const livenessEvidenceDocsRaw = Array.isArray(submission.selfieEvidenceImageUrls)
    ? submission.selfieEvidenceImageUrls
    : Array.isArray(submission.selfieEvidenceDataUrls)
      ? submission.selfieEvidenceDataUrls
      : []
  const livenessEvidenceDocs = livenessEvidenceDocsRaw
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, 4)

  const docs = [
    ["Government ID uploaded", submission.governmentIdImageUrl],
    ["Selfie uploaded", submission.selfieImageUrl],
    ...livenessEvidenceDocs.map((url, index) => [`Liveness capture ${index + 1}`, url]),
  ]

  return (
    <article className="work-card">
      <div className="card-head">
        <div>
          <p className="eyebrow">{submission.creatorEmail || submission.creator?.email || "Creator"}</p>
          <h2>
            Tier {submission.currentTier || 1} to Tier {submission.targetTier || 2}
          </h2>
        </div>
        <StatusPill status={submission.status || "awaiting_review"} />
      </div>

      <div className="detail-grid">
        <Detail label="Submitted" value={formatDate(submission.submittedAt || submission.createdAt)} />
        <Detail label="Reviewed" value={formatDate(submission.reviewedAt)} />
        <Detail label="Support Note" value={submission.supportNote || "No note"} wide />
        <Detail label="Rejection Reason" value={submission.rejectionReason || "None"} wide />
        <Detail
          label="Tier 3/4 Confirmation"
          value={submission.transactionHistoryConfirmed ? "Transaction history confirmed" : "Not confirmed"}
          wide
        />
        <Detail
          label="Tier 4 Address Proof"
          value={submission.addressVerificationProvided ? "Provided" : "Not provided"}
        />
        <Detail
          label="Tier 4 Creator/Business"
          value={submission.creatorBusinessVerificationProvided ? "Provided" : "Not provided"}
        />
        <Detail
          label="Tier 4 Due Diligence"
          value={submission.enhancedDueDiligenceAccepted ? "Accepted" : "Not accepted"}
        />
      </div>

      <div className="detail-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Submitted Documents</p>
            <h2>Government ID, Selfie, and Liveness Captures ({docs.filter(([, url]) => Boolean(url)).length})</h2>
          </div>
        </div>
        {docs.map(([label, url]) => (
          <div key={label} className="detail">
            <span>{label}</span>
            {url ? (
              <div className="action-row split">
                <a className="button ghost" href={url} target="_blank" rel="noreferrer">
                  <FileText size={17} />
                  Open Document
                </a>
              </div>
            ) : (
              <strong>Not uploaded</strong>
            )}
          </div>
        ))}
      </div>

      {submission.status === "awaiting_review" ? (
        <div className="action-row split">
          <button type="button" className="button success" onClick={() => onApprove(submission)} disabled={approving}>
            <Check size={17} />
            Approve Upgrade
          </button>
          <button type="button" className="button danger" onClick={() => onReject(submission)} disabled={rejecting}>
            <X size={17} />
            Reject Upgrade
          </button>
        </div>
      ) : null}
    </article>
  )
}

function ChangeRequestsView({
  requests,
  busyAction,
  cooldowns,
  reasons,
  onCooldownChange,
  onReasonChange,
  onApprove,
  onReject,
}) {
  if (!requests.length) {
    return <EmptyState icon={LockKeyhole} title="No payout account change request" />
  }

  return (
    <section className="content-grid">
      {requests.map((request) => (
        <article className="work-card" key={request.id}>
          <div className="card-head">
            <div>
              <p className="eyebrow">{request.creator?.email || "Creator"}</p>
              <h2>{request.creator?.name || "Payout account change"}</h2>
            </div>
            <StatusPill status={request.status} />
          </div>

          <div className="compare-grid">
            <AccountBox title="Current" profile={request.currentProfile} />
            <ChevronRight className="compare-arrow" size={20} />
            <AccountBox title="Requested" profile={request.requestedProfile} />
          </div>

          <div className="detail-grid">
            <Detail label="Submitted" value={formatDate(request.createdAt)} />
            <Detail label="Support note" value={request.supportNote || "No note"} wide />
            <Detail label="Proof summary" value={request.proofSummary || "No proof summary"} wide />
          </div>

          {request.status === "awaiting_review" ? (
            <>
              <div className="two-col">
                <label>
                  <span>Cooldown hours</span>
                  <input
                    type="number"
                    min="24"
                    max="72"
                    value={cooldowns[request.id] || 48}
                    onChange={(event) => onCooldownChange(request.id, event.target.value)}
                  />
                </label>
                <label>
                  <span>Rejection reason</span>
                  <input
                    value={reasons[request.id] || ""}
                    onChange={(event) => onReasonChange(request.id, event.target.value)}
                    placeholder="Required if rejecting"
                  />
                </label>
              </div>

              <div className="action-row">
                <button
                  type="button"
                  className="button success"
                  disabled={busyAction === `approve-change-${request.id}`}
                  onClick={() => onApprove(request.id)}
                >
                  <Check size={17} />
                  Approve
                </button>
                <button
                  type="button"
                  className="button danger"
                  disabled={busyAction === `reject-change-${request.id}`}
                  onClick={() => onReject(request.id)}
                >
                  <X size={17} />
                  Reject
                </button>
              </div>
            </>
          ) : null}
        </article>
      ))}
    </section>
  )
}

function UsersView({
  users,
  pagination,
  search,
  selectedUser,
  selectedUserDetails,
  edits,
  busyAction,
  onSearchChange,
  onSearchSubmit,
  onPageChange,
  onOpenUser,
  onEditChange,
  onSaveUser,
  onRequeryPaystack,
  onVerifyIdentity,
}) {
  const [identityVisibility, setIdentityVisibility] = useState({})

  const toggleIdentityVisibility = (userId, type) => {
    setIdentityVisibility((current) => ({
      ...current,
      [userId]: {
        bvn: type === "bvn" ? !current[userId]?.bvn : Boolean(current[userId]?.bvn),
        nin: type === "nin" ? !current[userId]?.nin : Boolean(current[userId]?.nin),
      },
    }))
  }

  return (
    <section className="users-panel">
      <div className="panel-toolbar users-toolbar">
        <div className="searchbox">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSearchSubmit()
            }}
            placeholder="Search streamer email"
          />
        </div>
        <button type="button" className="button primary" onClick={onSearchSubmit}>
          <Search size={17} />
          Search
        </button>
      </div>

      <div className="user-layout">
        <div className="user-table-panel">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Email</th>
                  <th>Date Registered</th>
                  <th>Identity</th>
                </tr>
              </thead>
              <tbody>
                {users.length ? (
                  users.map((user) => (
                    <tr
                      key={user.id}
                      className={String(selectedUser?.id || "") === String(user.id) ? "clickable selected" : "clickable"}
                      onClick={() => onOpenUser(user)}
                    >
                      <td>{getFirstName(user) || "Not available"}</td>
                      <td>{getLastName(user) || "Not available"}</td>
                      <td>{user.email}</td>
                      <td>{formatDate(user.createdAt)}</td>
                      <td>
                        <div className="identity-actions">
                          <button
                            type="button"
                            className="button ghost compact"
                            disabled={!user.identity?.hasBvn && !resolveIdentityNumber(user, "bvn")}
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleIdentityVisibility(user.id, "bvn")
                            }}
                          >
                            {identityVisibility[user.id]?.bvn ? "Hide BVN" : "View BVN"}
                          </button>
                          <button
                            type="button"
                            className="button ghost compact"
                            disabled={!user.identity?.hasNin && !resolveIdentityNumber(user, "nin")}
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleIdentityVisibility(user.id, "nin")
                            }}
                          >
                            {identityVisibility[user.id]?.nin ? "Hide NIN" : "View NIN"}
                          </button>
                          <div className="identity-values">
                            <span>
                              BVN:{" "}
                              {identityVisibility[user.id]?.bvn
                                ? resolveIdentityNumber(user, "bvn") || "Not submitted"
                                : maskIdentityNumber(resolveIdentityNumber(user, "bvn"))}
                            </span>
                            <span>
                              NIN:{" "}
                              {identityVisibility[user.id]?.nin
                                ? resolveIdentityNumber(user, "nin") || "Not submitted"
                                : maskIdentityNumber(resolveIdentityNumber(user, "nin"))}
                            </span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="empty-cell">
                      No user records found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <PaginationControls pagination={pagination} onPageChange={onPageChange} />
        </div>

        <UserDetailPanel
          user={selectedUser}
          details={selectedUserDetails}
          edit={selectedUser ? edits[selectedUser.id] || {} : {}}
          busyAction={busyAction}
          onEditChange={onEditChange}
          onSaveUser={onSaveUser}
          onRequeryPaystack={onRequeryPaystack}
          onVerifyIdentity={onVerifyIdentity}
        />
      </div>
    </section>
  )
}

function identityVerificationLabel(status) {
  if (status === "verified") return "Verified"
  if (status === "failed") return "Failed"
  if (status === "skipped") return "Skipped"
  return "Not verified"
}

function UserDetailPanel({ user, details, edit, busyAction, onEditChange, onSaveUser, onRequeryPaystack, onVerifyIdentity }) {
  if (!user) {
    return <EmptyState icon={UserCog} title="Select a user record" compact />
  }

  const payoutProfile = user.payoutProfile || {}
  const payouts = Array.isArray(details?.payouts) ? details.payouts : []
  const donations = Array.isArray(details?.donations) ? details.donations : []
  const changeRequests = Array.isArray(details?.changeRequests) ? details.changeRequests : []
  const wallet = user.wallet || {}
  const balance = details?.balance || {}

  return (
    <section className="user-detail">
      <div className="user-card-head">
        <div>
          <p className="eyebrow">{user.email}</p>
          <h2>{user.name || "Creator"}</h2>
        </div>
        <div className="pill-row">
          <StatusPill status={user.status || "active"} />
          <StatusPill status={payoutProfile.locked ? "verified" : "missing"} />
        </div>
      </div>

      <div className="user-grid">
        <label>
          <span>Name</span>
          <input
            value={edit.name ?? user.name ?? ""}
            onChange={(event) => onEditChange(user.id, "name", event.target.value)}
          />
        </label>
        <label>
          <span>Email</span>
          <input
            value={edit.email ?? user.email ?? ""}
            onChange={(event) => onEditChange(user.id, "email", event.target.value)}
          />
        </label>
        <label>
          <span>Phone</span>
          <input
            value={edit.phoneNumber ?? user.phoneNumber ?? ""}
            onChange={(event) => onEditChange(user.id, "phoneNumber", event.target.value)}
            placeholder="+2348012345678"
          />
        </label>
        <label>
          <span>Status</span>
          <select
            value={edit.status ?? user.status ?? "active"}
            onChange={(event) => onEditChange(user.id, "status", event.target.value)}
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="banned">Banned</option>
          </select>
        </label>
        <label>
          <span>KYC tier</span>
          <select
            value={String(edit.kycTier ?? user.kyc?.tier ?? user.kycTier ?? 1)}
            onChange={(event) => onEditChange(user.id, "kycTier", Number(event.target.value))}
          >
            <option value="1">Tier 1</option>
            <option value="2">Tier 2</option>
            <option value="3">Tier 3</option>
            <option value="4">Tier 4</option>
          </select>
        </label>
        <label>
          <span>KYC status</span>
          <select
            value={edit.kycStatus ?? user.kyc?.status ?? user.kycStatus ?? "incomplete"}
            onChange={(event) => onEditChange(user.id, "kycStatus", event.target.value)}
          >
            <option value="incomplete">Incomplete</option>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label>
          <span>Manual review</span>
          <select
            value={edit.manualReviewStatus ?? user.kyc?.manualReviewStatus ?? "not_required"}
            onChange={(event) => onEditChange(user.id, "manualReviewStatus", event.target.value)}
          >
            <option value="not_required">Not required</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label>
          <span>Daily limit override</span>
          <input
            type="number"
            min="0"
            value={edit.dailyReceivingLimitOverride ?? ""}
            onChange={(event) =>
              onEditChange(user.id, "dailyReceivingLimitOverride", event.target.value)
            }
            placeholder={formatCurrency(user.kyc?.dailyReceivingLimit || 0)}
          />
        </label>
        <label>
          <span>First name</span>
          <input
            value={edit.firstName ?? user.identity?.firstName ?? user.firstName ?? ""}
            onChange={(event) => onEditChange(user.id, "firstName", event.target.value)}
          />
        </label>
        <label>
          <span>Middle name</span>
          <input
            value={edit.middleName ?? user.identity?.middleName ?? user.middleName ?? ""}
            onChange={(event) => onEditChange(user.id, "middleName", event.target.value)}
          />
        </label>
        <label>
          <span>Last name</span>
          <input
            value={edit.lastName ?? user.identity?.lastName ?? user.lastName ?? ""}
            onChange={(event) => onEditChange(user.id, "lastName", event.target.value)}
          />
        </label>
        <label>
          <span>Date of birth</span>
          <input
            type="date"
            value={String(edit.dateOfBirth ?? user.identity?.dateOfBirth ?? "").slice(0, 10)}
            onChange={(event) => onEditChange(user.id, "dateOfBirth", event.target.value)}
          />
        </label>
        <label className="wide">
          <span>Edit reason</span>
          <input
            value={edit.reason || ""}
            onChange={(event) => onEditChange(user.id, "reason", event.target.value)}
            placeholder="Required to save creator record changes"
          />
        </label>
      </div>

      <div className="checkbox-grid">
        {[
          ["phoneVerified", "Phone verified", user.phoneVerified ?? user.kyc?.phoneVerified],
          ["bvnVerified", "BVN verified", user.kyc?.bvnVerified],
          ["ninVerified", "NIN verified", user.kyc?.ninVerified],
          ["selfieVerified", "Selfie/liveness verified", user.kyc?.selfieVerified],
          ["bankAccountMatched", "Bank name matched", user.kyc?.bankAccountMatched],
          ["proofOfAddressSubmitted", "Proof of address submitted", user.kyc?.proofOfAddressSubmitted],
          ["bankStatementSubmitted", "Bank statement submitted", user.kyc?.bankStatementSubmitted],
          ["socialMediaVerified", "Social handle verified", user.kyc?.socialMediaVerified],
        ].map(([field, label, currentValue]) => (
          <label key={field} className="check-row">
            <input
              type="checkbox"
              checked={Boolean(edit[field] ?? currentValue)}
              onChange={(event) => onEditChange(user.id, field, event.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <div className="ops-grid">
        <InfoBlock
          icon={CircleDollarSign}
          title="Wallet Snapshot"
          rows={[
            `Available: ${formatCurrency(wallet.availableBalance || 0)}`,
            `Pending Earnings: ${formatCurrency(wallet.pendingBalance || 0)}`,
            `Total Received: ${formatCurrency(wallet.totalReceived || 0)}`,
          ]}
        />
        <InfoBlock
          icon={Banknote}
          title="Ledger Balance"
          rows={[
            `Creator Revenue: ${formatCurrency(balance.creatorRevenue || 0)}`,
            `Paid Out: ${formatCurrency(balance.totalPaidOut || 0)}`,
            `Withdrawable Now: ${formatCurrency(balance.creatorAvailableBalance || 0)}`,
            `Pending Earnings: ${formatCurrency(balance.pendingCreatorRevenue || 0)}`,
          ]}
        />
        <InfoBlock
          icon={Banknote}
          title="Payout Profile"
          rows={[
            payoutProfile.locked ? "Locked" : "Missing",
            payoutProfile.bankName || "No bank",
            `${payoutProfile.accountName || "No account name"} - ${maskAccount(payoutProfile.accountNumber)}`,
          ]}
        />
        <InfoBlock
          icon={ShieldCheck}
          title="Identity"
          rows={[
            user.identity?.hasBvn ? "BVN saved" : "No BVN",
            user.identity?.hasNin ? "NIN saved" : "No NIN",
            `Submitted BVN: ${resolveIdentityNumber(user, "bvn") || "Not submitted"}`,
            `Submitted NIN: ${resolveIdentityNumber(user, "nin") || "Not submitted"}`,
            `BVN: ${identityVerificationLabel(user.identityVerification?.bvn?.status)}`,
            `NIN: ${identityVerificationLabel(user.identityVerification?.nin?.status)}`,
            `DOB: ${user.identity?.hasDateOfBirth ? String(user.identity?.dateOfBirth || "").slice(0, 10) : "Missing"}`,
            `KYC Tier ${user.kyc?.tier || user.kycTier || 1}`,
            `Status: ${user.kyc?.status || user.kycStatus || "incomplete"}`,
            [user.identity?.firstName, user.identity?.middleName, user.identity?.lastName]
              .filter(Boolean)
              .join(" ") || "No legal name",
          ]}
        />
      </div>

      <div className="action-row split">
        <button
          type="button"
          className="button ghost"
          disabled={busyAction === `save-user-${user.id}`}
          onClick={() => onSaveUser(user)}
        >
          <UserCog size={17} />
          Save User
        </button>
        {PAYSTACK_ENABLED && user.virtualAccount?.provider === "paystack" ? (
          <button
            type="button"
            className="button primary"
            disabled={busyAction === `requery-paystack-${user.id}`}
            onClick={() => onRequeryPaystack(user)}
          >
            <RefreshCcw size={17} />
            Requery Paystack VA
          </button>
        ) : null}
      </div>

      <div className="action-row split">
        <button
          type="button"
          className="button ghost"
          disabled={busyAction === `verify-identity-bvn-${user.id}` || !user.identity?.hasBvn}
          onClick={() => onVerifyIdentity(user, "bvn")}
        >
          <ShieldCheck size={17} />
          Verify BVN
        </button>
        <button
          type="button"
          className="button ghost"
          disabled={busyAction === `verify-identity-nin-${user.id}` || !user.identity?.hasNin}
          onClick={() => onVerifyIdentity(user, "nin")}
        >
          <ShieldCheck size={17} />
          Verify NIN
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busyAction === `verify-identity-both-${user.id}` || !user.identity?.hasBvn || !user.identity?.hasNin}
          onClick={() => onVerifyIdentity(user, "both")}
        >
          <ShieldCheck size={17} />
          Verify Both
        </button>
      </div>

      <div className="detail-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">User Withdrawals</p>
            <h2>Recent History</h2>
          </div>
          <span>{payouts.length}</span>
        </div>
        <MiniPayoutTable payouts={payouts} />
      </div>

      <div className="detail-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">User Gifts</p>
            <h2>Recent Inflows</h2>
          </div>
          <span>{donations.length}</span>
        </div>
        <MiniDonationTable donations={donations} />
      </div>

      <div className="detail-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Account Changes</p>
            <h2>Recent Requests</h2>
          </div>
          <span>{changeRequests.length}</span>
        </div>
        <MiniChangeTable requests={changeRequests} />
      </div>
    </section>
  )
}

function MiniPayoutTable({ payouts }) {
  return (
    <div className="table-wrap compact-table">
      <table className="data-table">
        <thead>
          <tr>
            <th>Requested</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Reviewed</th>
          </tr>
        </thead>
        <tbody>
          {payouts.length ? (
            payouts.map((payout) => (
              <tr key={payout.id}>
                <td>{formatDate(payout.createdAt)}</td>
                <td>{formatCurrency(payout.amount)}</td>
                <td>
                  <StatusPill status={payout.status} />
                </td>
                <td>{formatDate(payout.reviewedAt || payout.completedAt)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="4" className="empty-cell">
                No withdrawal history
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function MiniDonationTable({ donations }) {
  return (
    <div className="table-wrap compact-table">
      <table className="data-table">
        <thead>
          <tr>
            <th>Received</th>
            <th>Amount</th>
            <th>Source Name</th>
            <th>Session ID</th>
            <th>Alert Name</th>
          </tr>
        </thead>
        <tbody>
          {donations.length ? (
            donations.map((donation) => (
              <tr key={donation.id}>
                <td>{formatDate(donation.date)}</td>
                <td>{formatCurrency(donation.amount)}</td>
                <td>{donation.sourceAccountName || "Not synced"}</td>
                <td>{donation.sourceSessionId || "Not synced"}</td>
                <td>{donation.sender || "Anonymous"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="5" className="empty-cell">
                No gift history
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function MiniChangeTable({ requests }) {
  return (
    <div className="table-wrap compact-table">
      <table className="data-table">
        <thead>
          <tr>
            <th>Submitted</th>
            <th>Status</th>
            <th>Reviewed</th>
          </tr>
        </thead>
        <tbody>
          {requests.length ? (
            requests.map((request) => (
              <tr key={request.id}>
                <td>{formatDate(request.createdAt)}</td>
                <td>
                  <StatusPill status={request.status} />
                </td>
                <td>{formatDate(request.reviewedAt)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="3" className="empty-cell">
                No account change request
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function PaginationControls({ pagination, onPageChange }) {
  const page = pagination?.page || 1
  const totalPages = pagination?.totalPages || 1
  const total = pagination?.total || 0
  const limit = pagination?.limit || 20
  const start = total ? (page - 1) * limit + 1 : 0
  const end = Math.min(page * limit, total)

  return (
    <div className="pagination-row">
      <span>
        {start}-{end} of {total}
      </span>
      <div>
        <button
          type="button"
          className="icon-button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={!pagination?.hasPrevious}
          title="Previous page"
        >
          <ChevronLeft size={17} />
        </button>
        <strong>
          {page} / {totalPages}
        </strong>
        <button
          type="button"
          className="icon-button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={!pagination?.hasNext}
          title="Next page"
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  )
}

function Detail({ label, value, wide = false }) {
  return (
    <div className={wide ? "detail wide" : "detail"}>
      <span>{label}</span>
      <strong>{value || "Not available"}</strong>
    </div>
  )
}

function StatusPill({ status }) {
  const safeStatus = String(status || "unknown")
  return <span className={`status-pill ${statusTone(safeStatus)}`}>{safeStatus.replace(/_/g, " ")}</span>
}

function EmptyState({ icon: Icon, title, compact = false }) {
  return (
    <div className={compact ? "empty-state compact" : "empty-state"}>
      <Icon size={28} />
      <h2>{title}</h2>
    </div>
  )
}

function AccountBox({ title, profile }) {
  return (
    <div className="account-box">
      <span>{title}</span>
      <strong>{profile?.bankName || "No bank"}</strong>
      <p>{profile?.accountName || "No account name"}</p>
      <code>{maskAccount(profile?.accountNumber)}</code>
    </div>
  )
}

function InfoBlock({ icon: Icon, title, rows }) {
  return (
    <div className="info-block">
      <div>
        <Icon size={18} />
        <strong>{title}</strong>
      </div>
      {rows.map((row) => (
        <span key={row}>{row}</span>
      ))}
    </div>
  )
}

if (!redirectLegacyPublicRoutes()) {
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
