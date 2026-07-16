import {
  CoinReason,
  PrismaClient,
  ResidentGuideAudience,
  ResidentGuideCategory,
  ResidentGuideContentType,
  ResourceType
} from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.branch.upsert({
    where: { id: "D2" },
    update: { name: "D2" },
    create: { id: "D2", name: "D2" }
  });

  await prisma.branch.upsert({
    where: { id: "D7" },
    update: { name: "D7" },
    create: { id: "D7", name: "D7" }
  });

  const resources = [
    { branchId: "D2", type: ResourceType.WASHER, label: "Washer 1" },
    { branchId: "D7", type: ResourceType.WASHER, label: "Washer 1" },
    { branchId: "D7", type: ResourceType.WASHER, label: "Washer 2" },
    { branchId: "D7", type: ResourceType.DRYER, label: "Dryer 1" }
  ];

  for (const resource of resources) {
    const existing = await prisma.resource.findFirst({
      where: {
        branchId: resource.branchId,
        label: resource.label,
        type: resource.type
      }
    });

    if (!existing) {
      await prisma.resource.create({ data: resource });
    }
  }

  const balance = await prisma.coinLedger.aggregate({
    _sum: { delta: true },
    where: { userId: "demo-user" }
  });

  if ((balance._sum.delta ?? 0) <= 0) {
    await prisma.coinLedger.create({
      data: {
        userId: "demo-user",
        delta: 100,
        reason: CoinReason.TOPUP,
        refType: "seed",
        refId: "demo-user-initial-topup"
      }
    });
  }

  const seedGuides = [
    {
      slug: "laundry",
      titleVi: "Giặt sấy (Laundry)",
      titleEn: "Laundry",
      sortOrder: 10,
      contentType: ResidentGuideContentType.STEPS,
      category: ResidentGuideCategory.HOWTO,
      audience: ResidentGuideAudience.BOTH,
      videoUrl: null as string | null,
      stepsJson: [
        {
          bodyVi: "Mở tab Dịch vụ → Giặt sấy, chọn máy và khung giờ trống.",
          bodyEn: "Open Service → Laundry, pick a machine and an open time slot."
        },
        {
          bodyVi: "Đặt chỗ bằng Cozoro Coins; đến đúng giờ và bấm bắt đầu trên máy theo hướng dẫn tại chỗ.",
          bodyEn: "Book with Cozoro Coins; arrive on time and start the machine as posted on-site."
        }
      ],
      updatedBy: "seed"
    },
    {
      slug: "cleaning_schedule",
      titleVi: "Lịch vệ sinh (Cleaning)",
      titleEn: "Cleaning schedule",
      sortOrder: 20,
      contentType: ResidentGuideContentType.STEPS,
      category: ResidentGuideCategory.HOWTO,
      audience: ResidentGuideAudience.LONG_TERM,
      videoUrl: null as string | null,
      stepsJson: [
        {
          bodyVi: "Mở Lịch / Cleaning schedule để xem nhiệm vụ được giao hoặc slot trống.",
          bodyEn: "Open Schedule / Cleaning schedule to see assigned tasks or open slots."
        },
        {
          bodyVi: "Bạn có thể tự đăng ký slot trống (self-assign) theo quy định chi nhánh; hoàn thành đúng ngày để nhận thưởng coin.",
          bodyEn: "You can self-assign open slots per branch rules; complete on time for coin rewards."
        }
      ],
      updatedBy: "seed"
    },
    {
      slug: "check_in_long_term",
      titleVi: "Nhận phòng dài hạn",
      titleEn: "Long-term check-in",
      sortOrder: 5,
      contentType: ResidentGuideContentType.STEPS,
      category: ResidentGuideCategory.CHECK_IN,
      audience: ResidentGuideAudience.LONG_TERM,
      videoUrl: null as string | null,
      stepsJson: [
        {
          bodyVi: "Mang CCCD/Passport và hoàn tất thanh toán/cọc theo hướng dẫn của quản lý trước ngày nhận phòng.",
          bodyEn: "Bring your ID/passport and complete payment/deposit with staff before your move-in date."
        },
        {
          bodyVi: "Nhận mã cửa chính, số giường và hướng dẫn nội quy từ quản lý khi đến nhà.",
          bodyEn: "Receive the main-door code, bed number, and house rules from staff when you arrive."
        },
        {
          bodyVi: "Quét mã QR tại giường để lấy Wi‑Fi, đăng ký thiết bị và đọc nội quy phòng chung.",
          bodyEn: "Scan the QR code at your bed for Wi‑Fi, device registration, and shared-room rules."
        }
      ],
      updatedBy: "seed"
    },
    {
      slug: "check_in_short_term",
      titleVi: "Nhận phòng hostel / ngắn hạn",
      titleEn: "Hostel / short-term check-in",
      sortOrder: 6,
      contentType: ResidentGuideContentType.STEPS,
      category: ResidentGuideCategory.CHECK_IN,
      audience: ResidentGuideAudience.SHORT_TERM,
      videoUrl: null as string | null,
      stepsJson: [
        {
          bodyVi: "Hoàn tất thanh toán trên trang đặt phòng. Hệ thống sẽ gửi xác nhận và số giường sau khi thanh toán thành công.",
          bodyEn: "Complete payment on the booking site. You will receive confirmation and your bed number after payment succeeds."
        },
        {
          bodyVi: "Trong vòng 48 giờ trước check-in, mở trang face capture và chụp khuôn mặt kèm CCCD/Passport (không upload ảnh có sẵn).",
          bodyEn: "Within 48 hours before check-in, open the face-capture page and take a live photo of your face with your physical ID (no file upload)."
        },
        {
          bodyVi: "Dùng địa chỉ/Google Maps được gửi kèm mã khóa điện tử để vào cửa chính; tìm đúng số giường và tủ locker (thường trùng số giường).",
          bodyEn: "Use the shared Google Maps link and door-code instructions to enter; find your assigned bed and locker (locker number usually matches the bed)."
        },
        {
          bodyVi: "Quét mã QR tại giường để nhận Wi‑Fi, nội quy và danh sách tiện ích gần nhà.",
          bodyEn: "Scan the QR at your bed for Wi‑Fi, house rules, and nearby amenity tips."
        }
      ],
      updatedBy: "seed"
    }
  ];

  for (const g of seedGuides) {
    const existing = await prisma.residentGuideSection.findUnique({ where: { slug: g.slug } });
    if (!existing) {
      await prisma.residentGuideSection.create({ data: g });
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
