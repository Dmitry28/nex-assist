import type { CarListing, RemovedCarListing } from '../../dto/car-listing.dto';
import { SOLD_LOOKUP_RETENTION_DAYS } from '../../constants';

export const carA: CarListing = {
  link: 'https://bid.cars/ru/lot/1/vw-atlas-2024',
  title: '2024 Volkswagen Atlas',
  vin: 'VIN1',
  currentBid: '$1 500',
};

export const carB: CarListing = {
  link: 'https://bid.cars/ru/lot/2/toyota-camry-2022',
  title: '2022 Toyota Camry',
  vin: 'VIN2',
  currentBid: '$2 000',
};

export const carBRemoved: RemovedCarListing = {
  ...carB,
  removedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
};

export const carBRemovedExpired: RemovedCarListing = {
  ...carB,
  removedAt: new Date(
    Date.now() - (SOLD_LOOKUP_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000,
  ).toISOString(),
};

export const carBSold: RemovedCarListing = {
  ...carBRemoved,
  soldPrice: '$2 500',
};

export const carBEnded: CarListing = {
  ...carB,
  currentBid: '$2 500', // price in ended/archived = soldPrice
};
