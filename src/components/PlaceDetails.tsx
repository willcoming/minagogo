import {
  ExternalLink,
  MessageSquareText,
  Navigation,
  Star,
  Youtube,
} from "lucide-react";
import {
  formatRating,
  getDirectionsUrl,
  getPlaceMapsUrl,
  uniqueMentionChannels,
} from "../data";
import type { Place } from "../types";

type PlaceDetailsProps = {
  place: Place | null;
};

function reviewsUrl(place: Place): string {
  return place.google?.googleMapsLinks?.reviewsUri || getPlaceMapsUrl(place);
}

export function PlaceDetails({ place }: PlaceDetailsProps) {
  if (!place) {
    return (
      <section className="details-panel empty-details" aria-label="地點詳情">
        <MessageSquareText size={18} />
        <strong>選取地點查看詳情</strong>
        <span>點選左側清單或地圖 marker 後會顯示評分、影片來源與導航。</span>
      </section>
    );
  }

  return (
    <section className="details-panel" aria-label={`${place.name} 詳情`}>
      <div className="details-title">
        <div>
          <p>{place.category.label}</p>
          <h2>{place.name}</h2>
        </div>
        <span className="rating-score">
          <Star size={14} />
          {formatRating(place)}
        </span>
      </div>

      <dl className="detail-facts">
        <div>
          <dt>頻道</dt>
          <dd>{uniqueMentionChannels(place)}</dd>
        </div>
        {place.address ? (
          <div>
            <dt>地址</dt>
            <dd>{place.address}</dd>
          </div>
        ) : null}
      </dl>

      <div className="action-row">
        <a href={getPlaceMapsUrl(place)} target="_blank" rel="noreferrer">
          <ExternalLink size={16} />
          Google Maps
        </a>
        <a href={getDirectionsUrl(place)} target="_blank" rel="noreferrer">
          <Navigation size={16} />
          路線
        </a>
        <a href={reviewsUrl(place)} target="_blank" rel="noreferrer">
          <MessageSquareText size={16} />
          評論
        </a>
      </div>

      <div className="reviews-block">
        <h3>Google Maps 評論</h3>
        <article className="review-item">
          <header>
            <strong>{formatRating(place)}</strong>
            <span>
              {place.userRatingCount
                ? `${place.userRatingCount.toLocaleString("zh-TW")} 則評論`
                : "評論數未取得"}
            </span>
          </header>
          <p>完整評論保留在 Google Maps，可用上方評論連結查看。</p>
        </article>
      </div>

      <div className="mentions-block">
        <h3>YouTube 來源</h3>
        {place.mentions.map((mention) => (
          <article key={mention.id} className="mention-item">
            <header>
              <span>{mention.channelName}</span>
              {mention.time ? <small>{mention.time}</small> : null}
            </header>
            <a href={mention.videoUrl} target="_blank" rel="noreferrer">
              <Youtube size={15} />
              {mention.videoTitle || "YouTube"}
            </a>
            {mention.youtubeReview ? <p>{mention.youtubeReview}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
