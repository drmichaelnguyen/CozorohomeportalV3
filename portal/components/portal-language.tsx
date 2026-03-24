"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type PortalLanguage = "en" | "vi";

type PortalLanguageContextValue = {
  language: PortalLanguage;
  setLanguage: (language: PortalLanguage) => void;
  t: (key: string, fallback?: string) => string;
};

const PORTAL_LANGUAGE_STORAGE_KEY = "cozorohome-portal-language";

const translations: Record<string, { en: string; vi: string }> = {
  portalTitle: { en: "CozoroHome Portal", vi: "C\u1ed5ng th\u00f4ng tin CozoroHome" },
  home: { en: "Home", vi: "Trang ch\u1ee7" },
  clientServices: { en: "Client Services", vi: "D\u1ecbch v\u1ee5 kh\u00e1ch h\u00e0ng" },
  billingCenter: { en: "Billing & Fines", vi: "Thanh to\u00e1n v\u00e0 ti\u1ec1n ph\u1ea1t" },
  bookings: { en: "Bookings", vi: "\u0110\u1eb7t l\u1ecbch" },
  controller: { en: "Controller", vi: "\u0110i\u1ec1u khi\u1ec3n" },
  accountOverview: { en: "Account Overview", vi: "T\u1ed5ng quan t\u00e0i kho\u1ea3n" },
  coins: { en: "Coins", vi: "Cozoro Coins" },
  payments: { en: "Payments", vi: "Thanh to\u00e1n" },
  fines: { en: "Fines", vi: "Ti\u1ec1n ph\u1ea1t" },
  cleaningSchedule: { en: "Cleaning Schedule", vi: "L\u1ecbch v\u1ec7 sinh" },
  adminCleaning: { en: "Admin Cleaning", vi: "Ph\u00e2n c\u00f4ng l\u1ecbch v\u1ec7 sinh" },
  manager: { en: "Manager", vi: "Qu\u1ea3n l\u00fd" },
  notifications: { en: "Notifications", vi: "Th\u00f4ng b\u00e1o" },
  support: { en: "Messages", vi: "Tin nhắn" },
  clientLogin: { en: "Client Login", vi: "\u0110\u0103ng nh\u1eadp kh\u00e1ch h\u00e0ng" },
  language: { en: "Language", vi: "Ng\u00f4n ng\u1eef" },
  english: { en: "English", vi: "Ti\u1ebfng Anh" },
  vietnamese: { en: "Vietnamese", vi: "Ti\u1ebfng Vi\u1ec7t" },
  homepageTitle: { en: "CozoroHome Portal", vi: "C\u1ed5ng th\u00f4ng tin CozoroHome" },
  paymentHistory: { en: "Payment History", vi: "L\u1ecbch s\u1eed thanh to\u00e1n" },
  viewPaymentHistory: { en: "View payment history", vi: "Xem l\u1ecbch s\u1eed thanh to\u00e1n" },
  refreshPayments: { en: "Refresh payments", vi: "L\u00e0m m\u1edbi thanh to\u00e1n" },
  myPaymentEntries: { en: "My Payment Entries", vi: "C\u00e1c kho\u1ea3n thanh to\u00e1n c\u1ee7a t\u00f4i" },
  purpose: { en: "Purpose", vi: "M\u1ee5c \u0111\u00edch" },
  sort: { en: "Sort", vi: "S\u1eafp x\u1ebfp" },
  nextPayment: { en: "Next Payment", vi: "K\u1ef3 thanh to\u00e1n ti\u1ebfp theo" },
  coinsTitle: { en: "Coins", vi: "Cozoro Coins" },
  viewCoinHistory: { en: "View coin history", vi: "Xem l\u1ecbch s\u1eed coin" },
  refreshCoins: { en: "Refresh coins", vi: "L\u00e0m m\u1edbi coin" },
  myCoinEntries: { en: "My Coin Entries", vi: "Giao d\u1ecbch coin c\u1ee7a t\u00f4i" },
  recentHistory: { en: "Recent history", vi: "L\u1ecbch s\u1eed g\u1ea7n \u0111\u00e2y" },
  showFilters: { en: "Show filters and more history", vi: "Hi\u1ec7n b\u1ed9 l\u1ecdc v\u00e0 th\u00eam l\u1ecbch s\u1eed" },
  hideFilters: { en: "Hide filters and full history", vi: "\u1ea8n b\u1ed9 l\u1ecdc v\u00e0 to\u00e0n b\u1ed9 l\u1ecbch s\u1eed" },
  showMore10: { en: "Show 10 more", vi: "Xem th\u00eam 10 d\u00f2ng" },
  showFewer: { en: "Show fewer", vi: "Thu g\u1ecdn" },
  event: { en: "Event", vi: "S\u1ef1 ki\u1ec7n" },
  timestamp: { en: "Timestamp", vi: "Th\u1eddi gian" },
  operator: { en: "Operator", vi: "Ng\u01b0\u1eddi thao t\u00e1c" },
  finesTitle: { en: "Fines", vi: "Ti\u1ec1n ph\u1ea1t" },
  viewFineHistory: { en: "View fine history", vi: "Xem l\u1ecbch s\u1eed ti\u1ec1n ph\u1ea1t" },
  refreshFines: { en: "Refresh fines", vi: "L\u00e0m m\u1edbi ti\u1ec1n ph\u1ea1t" },
  laundryBookingsTitle: { en: "Laundry Bookings", vi: "\u0110\u1eb7t l\u1ecbch gi\u1eb7t s\u1ea5y" },
  acControllerTitle: { en: "Room Controller", vi: "\u0110i\u1ec1u khi\u1ec3n m\u00e1y l\u1ea1nh" },
  loadBookingOptions: { en: "Load booking options", vi: "T\u1ea3i t\u00f9y ch\u1ecdn \u0111\u1eb7t l\u1ecbch" },
  bookLaundrySlot: { en: "Book laundry slot", vi: "\u0110\u1eb7t l\u1ecbch gi\u1eb7t s\u1ea5y" },
  accountOverviewTitle: { en: "Account Overview", vi: "Tổng quan tài khoản" },
  service: { en: "Service", vi: "Dịch vụ" },
  schedule: { en: "Schedule", vi: "Lịch trình" },
  userView: { en: "User view", vi: "Giao diện người dùng" },
  managerView: { en: "Manager view", vi: "Giao diện quản lý" },
  signedInAs: { en: "Signed in as", vi: "Đăng nhập với" },
  logout: { en: "Log out", vi: "Đăng xuất" },
  loginRequired: { en: "Login Required", vi: "Yêu cầu đăng nhập" },
  loginRequiredSub: { en: "Please sign in with an active user email or a pre-approved Cozoro team email before using the portal.", vi: "Vui lòng đăng nhập bằng email người dùng đang hoạt động hoặc email được nhóm Cozoro phê duyệt trước khi sử dụng cổng thông tin." },
  goToLogin: { en: "Go to login", vi: "Đi đến trang đăng nhập" },
  laundryQuickLink: { en: "Laundry", vi: "Giặt sấy" },
  laundryDesc: { en: "Book laundry and check machine availability", vi: "Đặt lịch giặt sấy và kiểm tra tình trạng máy" },
  controllerDesc: { en: "Control your room devices", vi: "Điều khiển thiết bị trong phòng của bạn" },
  scheduleDesc: { en: "See cleaning duties and next laundry", vi: "Xem lịch trực vệ sinh và lịch giặt sấy tiếp theo" },
  billingsDesc: { en: "Review laundry fees and fines", vi: "Xem phí giặt sấy và tiền phạt" },
  coinsDesc: { en: "Check your current coins and member status", vi: "Xem số lượng coin hiện tại và trạng thái thành viên" },
  finesDesc: { en: "Review unpaid fine tickets", vi: "Xem các phiếu phạt chưa thanh toán" },
  yourDashboard: { en: "Your dashboard", vi: "Bảng điều khiển của bạn" },
  dashboardSubtext: { en: "A quick view of your account, bookings, cleaning schedule, and unpaid fine tickets.", vi: "Xem nhanh tài khoản, lịch giặt sấy, lịch trực vệ sinh và các phiếu phạt chưa thanh toán." },
  refreshing: { en: "Refreshing...", vi: "Đang làm mới..." },
  refreshDashboard: { en: "Refresh dashboard", vi: "Làm mới bảng điều khiển" },
  signInToView: { en: "Sign in first to view your dashboard.", vi: "Đăng nhập trước để xem bảng điều khiển của bạn." },
  unableToLoadDashboard: { en: "Unable to load dashboard.", vi: "Không thể tải bảng điều khiển." },
  dashboardPartialData: { en: "Dashboard loaded with partial data.", vi: "Bảng điều khiển được tải với dữ liệu không đầy đủ." },
  unableToLoadRightNow: { en: "Unable to load dashboard right now.", vi: "Hiện tại không thể tải bảng điều khiển." },
  currentCoins: { en: "Current Coins", vi: "Số coin hiện tại" },
  coinsEarnedLastMonth: { en: "Coins Earned Last Month", vi: "Số coin kiếm được tháng trước" },
  coinsEarnedThisMonth: { en: "Coins Earned This Month", vi: "Số coin kiếm được tháng này" },
  nextCleaning: { en: "Next Cleaning", vi: "Lịch vệ sinh tiếp theo" },
  unpaidFineTickets: { en: "Unpaid Fine Tickets", vi: "Phiếu phạt chưa thanh toán" },
  noUpcomingTask: { en: "No upcoming task", vi: "Không có lịch sắp tới" },
  clearForNow: { en: "You are clear for now.", vi: "Hiện tại bạn chưa có lịch." },
  totalUnpaidAmount: { en: "Total unpaid amount", vi: "Tổng tiền chưa nộp" },
  briefUserInfo: { en: "Brief User Info", vi: "Thông tin cơ bản" },
  openFullAccount: { en: "Open full account", vi: "Mở tài khoản" },
  name: { en: "Name", vi: "Tên" },
  branch: { en: "Branch", vi: "Chi nhánh" },
  bedNumber: { en: "Bed Number", vi: "Giường" },
  floorLabel: { en: "Floor", vi: "Tầng" },
  roomLabel: { en: "Room", vi: "Phòng" },
  phone: { en: "Phone", vi: "Số điện thoại" },
  emailLabel: { en: "Email", vi: "Email" },
  nextLaundry: { en: "Next Laundry", vi: "Lịch giặt sấy tới" },
  openLaundry: { en: "Open laundry", vi: "Mở giặt sấy" },
  noUpcomingLaundry: { en: "No upcoming laundry booking is scheduled.", vi: "Chưa có lịch đặt máy tiếp theo." },
  status: { en: "Status", vi: "Trạng thái" },
  accountSnapshot: { en: "Account Snapshot", vi: "Tóm tắt tài khoản" },
  reviewFines: { en: "Review fines", vi: "Xem tiền phạt" },
  cozoroMember: { en: "Cozoro Member", vi: "Thành viên Cozoro" },
  contractCode: { en: "Contract Code", vi: "Mã HD" },
  paidThrough: { en: "Paid Through", vi: "Đã thanh toán đến" },
  coinsUsedByMonth: { en: "Coins Used by Month", vi: "Coin sử dụng theo tháng" },
  openCoins: { en: "Open coins", vi: "Mở trang coin" },
  noMonthlyCoinUsage: { en: "No monthly coin usage is available yet.", vi: "Chưa có thay đổi coin nào theo tháng." },
  coinsUsedByCategory: { en: "Coins Used by Category", vi: "Coin sử dụng theo Danh mục" },
  noCategoryCoinUsage: { en: "No coin usage categories are available yet.", vi: "Chưa có thay đổi coin nào theo danh mục." },
  enterPasswordClient: { en: "Enter your password. For clients, the default first password is your phone number.", vi: "Nhập mật khẩu. Với khách hàng, mật khẩu mặc định là số điện thoại." },
  onlyActiveUsersLogin: { en: "Only active users or pre-approved Cozoro team emails can log in.", vi: "Chỉ người dùng đang hoạt động hoặc email được phê duyệt mới được đăng nhập." },
  changePasswordToContinue: { en: "Please change your password before continuing.", vi: "Vui lòng đổi mật khẩu trước khi tiếp tục." },
  defaultPasswordAccepted: { en: "Default password accepted. Client information loaded.", vi: "Đã chấp nhận mật khẩu mặc định. Đã tải thông tin khách hàng." },
  passwordCreatedSuffix: { en: "Password created.", vi: "Đã tạo mật khẩu." },
  viewLoadedSuffix: { en: "view loaded.", vi: "đã được tải." },
  clientInfoLoaded: { en: "Client information loaded.", vi: "Đã tải thông tin khách hàng." },
  apiRequestFailed: { en: "API request failed. Make sure the API is running and Google Sheets has been connected.", vi: "Yêu cầu API thất bại. Đảm bảo API đang chạy và kết nối Sheets." },
  googleSignInSuccessClient: { en: "Google sign-in successful. Client information loaded.", vi: "Đăng nhập Google thành công. Đã tải thông tin khách hàng." },
  googleSignInSuccess: { en: "Google sign-in successful.", vi: "Đăng nhập Google thành công." },
  googleSignInFailed: { en: "Google sign-in failed.", vi: "Đăng nhập Google thất bại." },
  portalSession: { en: "Portal Session", vi: "Phiên người dùng" },
  clientLoginHeader: { en: "Client Login", vi: "Đăng nhập" },
  activeUsersCanLogin: { en: "Active users can log in from the client list. Cozoro team members can also log in if an owner has pre-approved their email.", vi: "Người dùng có thể đăng nhập. Thành viên Cozoro cũng có thể đăng nhập nếu đã được phê duyệt email." },
  useGoogleToSignIn: { en: "Use Google to sign in with the account tied to your active client or approved app management email.", vi: "Dùng Google đăng nhập với tài khoản liên kết hoặc email được phê duyệt." },
  passwordToolsBelow: { en: "Password tools are in the Account Security section below.", vi: "Các công cụ mật khẩu nằm trong mục Bảo mật Tài khoản bên dưới." },
  changePassword: { en: "Change password", vi: "Đổi mật khẩu" },
  useAnotherEmail: { en: "Use another email", vi: "Dùng email khác" },
  continueWithGoogle: { en: "Continue with Google", vi: "Tiếp tục với Google" },
  signInGoogleTied: { en: "Sign in with the Google account tied to your active client or approved Cozoro team email.", vi: "Đăng nhập bằng tài khoản Google được liên kết hoặc đã phê duyệt." },
  googleNotConfigured: { en: "Google sign-in is not configured yet on this environment.", vi: "Google sign-in chưa được cấu hình." },
  signInWithEmail: { en: "Sign in with email", vi: "Đăng nhập bằng email" },
  ifYouSignedOut: { en: "If you signed out on this computer, the email and password fields will show again here.", vi: "Các trường đăng nhập sẽ hiển thị lại nếu bạn đã đăng xuất trên máy này." },
  passwordPlaceholder: { en: "Enter your password", vi: "Nhập mật khẩu của bạn" },
  hidePassword: { en: "Hide password", vi: "Ẩn mật khẩu" },
  showPassword: { en: "Show password", vi: "Hiện mật khẩu" },
  rememberLogin: { en: "Remember this login on this computer", vi: "Ghi nhớ đăng nhập trên máy tính này" },
  signingIn: { en: "Signing in...", vi: "Đang đăng nhập..." },
  logInWithEmailBtn: { en: "Log in with email", vi: "Đăng nhập bằng email" },
  accountSecurity: { en: "Account Security", vi: "Bảo mật Tài khoản" },
  firstLoginDetected: { en: "First login detected. Please change your password before continuing to use the portal.", vi: "Phát hiện lần đăng nhập đầu. Vui lòng đổi mật khẩu trước khi tiếp tục." },
  changePasswordAnytime: { en: "You can change your password here at any time.", vi: "Bạn có thể đổi mật khẩu ở đây bất kỳ lúc nào." },
  currentPassword: { en: "Current password", vi: "Mật khẩu hiện tại" },
  enterCurrentPassword: { en: "Enter current password", vi: "Nhập mật khẩu hiện tại" },
  newPassword: { en: "New password", vi: "Mật khẩu mới" },
  chooseNewPassword: { en: "Choose a new password", vi: "Chọn mật khẩu mới" },
  pleaseLoginBeforeChange: { en: "Please log in before changing your password.", vi: "Vui lòng đăng nhập trước khi đổi mật khẩu." },
  enterBothPasswords: { en: "Enter both your current password and a new password.", vi: "Nhập cả mật khẩu hiện tại và mật khẩu mới." },
  unableToChangePassword: { en: "Unable to change password.", vi: "Không thể đổi mật khẩu." },
  passwordChangedSuccess: { en: "Password changed successfully.", vi: "Đã đổi mật khẩu thành công." },
  myInformation: { en: "My Information", vi: "Thông tin của tôi" },
  submitEmailToLoad: { en: "Submit your email to load the active client row.", vi: "Gửi email của bạn để tải về thông tin khách hàng đang hoạt động." },
  userViewShort: { en: "User", vi: "Người dân" },
  managerViewShort: { en: "Manager", vi: "Quản lý" },
  managerWorkspace: { en: "Manager Workspace", vi: "Không gian làm việc quản lý" },
  openManagerOverview: { en: "Open manager overview", vi: "Mở tổng quan quản lý" },
  openOwnersEmployees: { en: "Open Owners & employees", vi: "Mở mục Chủ sở hữu & Nhân viên" },
  openCleaningScheduleAssign: { en: "Open Cleaning schedule assigning", vi: "Mở mục phân công lịch vệ sinh" },
  confirmPassword: { en: "Confirm new password", vi: "Xác nhận mật khẩu mới" },
  passwordsDoNotMatch: { en: "Passwords do not match.", vi: "Mật khẩu không khớp." },
  passwordTooShort: { en: "Password must be at least 4 characters.", vi: "Mật khẩu phải có ít nhất 4 ký tự." },
  changingPassword: { en: "Changing password...", vi: "Đang đổi mật khẩu..." },
  personalMessages: { en: "Personal", vi: "Cá nhân" },
  roomGroup: { en: "Room", vi: "Phòng" },
  floorGroup: { en: "Floor", vi: "Tầng" },
  branchGroup: { en: "Branch", vi: "Cơ sở" },
  sendAnonymously: { en: "Send anonymously (Hide my identity)", vi: "Gửi ẩn danh (Ẩn danh tính)" },
  sendAsCozoro: { en: "Send as Cozoro (Hide my name)", vi: "Gửi dưới tên Cozoro (Ẩn tên tôi)" },
  saySomethingToNeighbors: { en: "Say something to your neighbors...", vi: "Nói gì đó với hàng xóm của bạn..." },
  publicGroupHistory: { en: "Public group message history", vi: "Lịch sử tin nhắn nhóm công khai" },
  residentMessages: { en: "Messages & Community", vi: "Tin nhắn & Cộng đồng" },
  messagesChatDesc: { en: "Communicate with Cozoro staff or connect with your neighbors in group chats.", vi: "Trao đổi với nhân viên Cozoro hoặc kết nối với hàng xóm trong các nhóm chat." },
  room: { en: "Room", vi: "Phòng" },
  floor: { en: "Floor", vi: "Tầng" },


  booking: { en: "Booking", vi: "Đặt lịch" },
  message: { en: "Message", vi: "Tin nhắn" },
  account: { en: "Account", vi: "Tài khoản" }
};

const PortalLanguageContext = createContext<PortalLanguageContextValue | null>(null);

export function PortalLanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<PortalLanguage>("en");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const saved = window.localStorage.getItem(PORTAL_LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "vi") {
      setLanguageState(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(PORTAL_LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language === "vi" ? "vi" : "en";
  }, [language]);

  const value = useMemo<PortalLanguageContextValue>(
    () => ({
      language,
      setLanguage: (nextLanguage) => setLanguageState(nextLanguage),
      t: (key, fallback) => translations[key]?.[language] ?? fallback ?? key
    }),
    [language]
  );

  return <PortalLanguageContext.Provider value={value}>{children}</PortalLanguageContext.Provider>;
}

export function usePortalLanguage() {
  const context = useContext(PortalLanguageContext);
  if (!context) {
    throw new Error("usePortalLanguage must be used inside PortalLanguageProvider");
  }

  return context;
}
