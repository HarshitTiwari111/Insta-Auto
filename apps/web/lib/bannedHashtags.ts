/**
 * Hashtags that are commonly reported as blocked / restricted by Instagram.
 * Instagram does not publish an official list and it changes over time, so this is a warning only.
 */
const BANNED = new Set(
  [
    "adulting", "alone", "armparty", "asiangirl", "beautyblogger", "bikinibody", "boho", "brain", "costumes",
    "curvygirls", "date", "dating", "desk", "direct", "dm", "elevator", "eggplant", "girlsonly", "gloves",
    "hardworkpaysoff", "hawks", "hotweather", "humpday", "hustler", "ilovemyinstagram", "instasport", "iphones",
    "kansas", "kickoff", "killingit", "kissing", "lean", "lingerie", "loseweight", "master", "models", "mustfollow",
    "nasty", "newyearsday", "nudity", "petite", "pornfood", "pushups", "rate", "saltwater", "selfharm", "shower",
    "single", "singlelife", "skype", "snap", "snapchat", "snowstorm", "sopretty", "stranger", "streetphoto",
    "sunbathing", "swole", "tag4like", "tagsforlikes", "teen", "teens", "thought", "todayimwearing", "twerk",
    "undies", "valentinesday", "workflow", "youngmodel",
    // follow/like-for-like spam tags
    "follow4follow", "followforfollow", "f4f", "like4like", "likeforlike", "l4l", "likeforfollow", "followback",
  ],
);

/** Hashtags in `text` that are on the blocked list (lower-case, without #, no repeats). */
export function bannedHashtags(text: string): string[] {
  const found = (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.slice(1).toLowerCase()).filter((t) => BANNED.has(t));
  return [...new Set(found)];
}
