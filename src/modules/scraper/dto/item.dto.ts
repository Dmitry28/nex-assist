export interface Item {
  title: string | undefined;
  link: string | undefined;
  price?: string;
  area?: string;
  address?: string;
  cadastralNumber?: string;
  cadastralMapUrl?: string;
  auctionDate?: string;
  applicationDeadline?: string;
  communications?: string;
  images?: string[];
}

export interface Details {
  price: string;
  area: string;
  address: string;
  cadastralNumber: string;
  cadastralMapUrl: string;
  auctionDate: string;
  applicationDeadline: string;
  communications: string;
  images: string[];
}

export interface ScraperResult {
  total: number;
  newItems: Item[];
  removedItems: Item[];
  specialItems: Item[];
  newSpecialItems: Item[];
}
