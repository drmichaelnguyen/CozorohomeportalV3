-- Add CLEANING_SWAP_DEBIT and CLEANING_SWAP_CREDIT to CoinReason enum
ALTER TABLE `CoinLedger`
  MODIFY COLUMN `reason`
  ENUM('BOOKING_CHARGE','TOPUP','ADJUSTMENT','REFUND',
       'CLEANING_REWARD','CLEANING_REVERSAL',
       'CLEANING_SWAP_DEBIT','CLEANING_SWAP_CREDIT')
  NOT NULL;

-- Create CleaningSwapRequest table
CREATE TABLE `CleaningSwapRequest` (
  `id`                VARCHAR(191) NOT NULL,
  `taskId`            VARCHAR(191) NOT NULL,
  `requesterEmail`    VARCHAR(191) NOT NULL,
  `requesterName`     VARCHAR(191) NULL,
  `targetEmail`       VARCHAR(191) NOT NULL,
  `targetName`        VARCHAR(191) NULL,
  `offeredCoins`      INT          NOT NULL DEFAULT 0,
  `status`            ENUM('PENDING','ACCEPTED','DECLINED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `taskType`          ENUM('KITCHEN_D2','KITCHEN_D7','TRASH_D7') NOT NULL,
  `taskScheduledDate` DATETIME(3) NOT NULL,
  `taskBranchId`      VARCHAR(191) NOT NULL,
  `taskRewardCoins`   INT NOT NULL,
  `respondedAt`       DATETIME(3) NULL,
  `cancelledAt`       DATETIME(3) NULL,
  `createdAt`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `CleaningSwapRequest_requesterEmail_status_createdAt_idx`
  ON `CleaningSwapRequest`(`requesterEmail`, `status`, `createdAt`);

CREATE INDEX `CleaningSwapRequest_targetEmail_status_createdAt_idx`
  ON `CleaningSwapRequest`(`targetEmail`, `status`, `createdAt`);

CREATE INDEX `CleaningSwapRequest_taskId_status_idx`
  ON `CleaningSwapRequest`(`taskId`, `status`);
