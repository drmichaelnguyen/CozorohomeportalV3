ALTER TABLE `CleaningTask` ADD COLUMN `assignmentExplanation` JSON NULL;
CREATE TABLE `CleaningAssignmentReview` (
  `id` VARCHAR(191) NOT NULL, `taskId` VARCHAR(191) NOT NULL,
  `userEmail` VARCHAR(191) NOT NULL, `userName` VARCHAR(191) NULL,
  `branchId` VARCHAR(191) NOT NULL, `taskType` VARCHAR(191) NOT NULL,
  `scheduledDate` DATETIME(3) NOT NULL, `explanation` JSON NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `CleaningAssignmentReview_taskId_userEmail_key` (`taskId`, `userEmail`),
  INDEX `CleaningAssignmentReview_status_updatedAt_idx` (`status`, `updatedAt`),
  INDEX `CleaningAssignmentReview_userEmail_idx` (`userEmail`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `CleaningAssignmentReviewMessage` (
  `id` VARCHAR(191) NOT NULL, `reviewId` VARCHAR(191) NOT NULL,
  `authorRole` VARCHAR(191) NOT NULL, `body` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `CleaningAssignmentReviewMessage_reviewId_createdAt_idx` (`reviewId`, `createdAt`),
  CONSTRAINT `CleaningAssignmentReviewMessage_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `CleaningAssignmentReview` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
