(function (root) {
  const BUSINESS_TIME_ZONE = "Asia/Ho_Chi_Minh";

  function businessTodayKey(now) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: BUSINESS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now || new Date());
  }

  function addBusinessDays(isoDate, days) {
    const match = String(isoDate || "")
      .trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return "";
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utc = new Date(Date.UTC(year, month - 1, day + Number(days), 12, 0, 0, 0));
    return utc.toISOString().slice(0, 10);
  }

  function nightsBetween(checkIn, checkOut) {
    const start = new Date(`${checkIn}T12:00:00.000Z`);
    const end = new Date(`${checkOut}T12:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) {
      return 0;
    }
    return Math.round((end.getTime() - start.getTime()) / 86400000);
  }

  root.CozoroBusinessDates = {
    BUSINESS_TIME_ZONE,
    businessTodayKey,
    addBusinessDays,
    nightsBetween
  };
})(typeof window !== "undefined" ? window : globalThis);
