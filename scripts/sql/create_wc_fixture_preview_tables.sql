-- World Cup sidebar fixture schedule support tables
-- Database: worldcupdb

CREATE TABLE WCFixture (
  FixtureID STRING(64) NOT NULL,
  MatchNumber INT64,
  HomeSlug STRING(64),
  AwaySlug STRING(64),
  Stage STRING(16),
  GroupLetter STRING(1),
  Venue STRING(256),
  City STRING(128),
  Kickoff TIMESTAMP
) PRIMARY KEY (FixtureID);

CREATE TABLE WCMatchPreview (
  FixtureID STRING(64) NOT NULL,
  WriteupUrl STRING(1024) NOT NULL,
  WriteupTitle STRING(512),
  PublishedAt TIMESTAMP OPTIONS (allow_commit_timestamp = true),
  UpdatedAt TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (FixtureID);
