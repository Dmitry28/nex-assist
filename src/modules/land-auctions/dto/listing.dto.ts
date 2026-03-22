/** A single land auction listing from gcn.by. */
export interface Listing {
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

/** Full detail fields fetched from the listing's own page. */
export interface ListingDetails {
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

export interface LandAuctionsResult {
  total: number;
  newListings: Listing[];
  removedListings: Listing[];
  /** All listings matching the special keyword (e.g. Заболоть area). */
  specialListings: Listing[];
  newSpecialListings: Listing[];
}
