import * as fs from "fs";
import * as path from "path";

// Pokemon types
const POKEMON_TYPES = [
  "Normal", "Fire", "Water", "Electric", "Grass", "Ice",
  "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug",
  "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"
];

// Rarity names
const RARITIES = ["Common", "Uncommon", "Rare", "Ultra Rare", "Legendary"];

// Background colors by type
const TYPE_COLORS: { [key: string]: string } = {
  Normal: "A8A878",
  Fire: "F08030",
  Water: "6890F0",
  Electric: "F8D030",
  Grass: "78C850",
  Ice: "98D8D8",
  Fighting: "C03028",
  Poison: "A040A0",
  Ground: "E0C068",
  Flying: "A890F0",
  Psychic: "F85888",
  Bug: "A8B820",
  Rock: "B8A038",
  Ghost: "705898",
  Dragon: "7038F8",
  Dark: "705848",
  Steel: "B8B8D0",
  Fairy: "EE99AC"
};

// Sample Pokemon data
const SAMPLE_POKEMON = [
  { name: "Pikachu", type: "Electric", gen: 1 },
  { name: "Charizard", type: "Fire", gen: 1 },
  { name: "Blastoise", type: "Water", gen: 1 },
  { name: "Venusaur", type: "Grass", gen: 1 },
  { name: "Mewtwo", type: "Psychic", gen: 1 },
  { name: "Gengar", type: "Ghost", gen: 1 },
  { name: "Dragonite", type: "Dragon", gen: 1 },
  { name: "Lucario", type: "Fighting", gen: 4 },
  { name: "Garchomp", type: "Dragon", gen: 4 },
  { name: "Greninja", type: "Water", gen: 6 }
];

interface CardMetadata {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: Array<{
    trait_type: string;
    value: string | number;
    max_value?: number;
    display_type?: string;
  }>;
  background_color: string;
}

function generateMetadata(
  tokenId: number,
  pokemonName: string,
  pokemonType: string,
  rarity: string,
  hp: number,
  attack: number,
  defense: number,
  speed: number,
  generation: number,
  imageUri: string
): CardMetadata {
  return {
    name: `${pokemonName} #${tokenId.toString().padStart(3, "0")}`,
    description: `${rarity} ${pokemonType}-type Pokemon card from PokeDEX collection.`,
    image: imageUri,
    external_url: `https://pokedex.app/card/${tokenId}`,
    attributes: [
      { trait_type: "Type", value: pokemonType },
      { trait_type: "HP", value: hp, max_value: 255 },
      { trait_type: "Attack", value: attack, max_value: 255 },
      { trait_type: "Defense", value: defense, max_value: 255 },
      { trait_type: "Speed", value: speed, max_value: 255 },
      { trait_type: "Rarity", value: rarity },
      { trait_type: "Generation", value: generation },
      { display_type: "number", trait_type: "Experience", value: 0 }
    ],
    background_color: TYPE_COLORS[pokemonType] || "FFFFFF"
  };
}

function generateRandomStat(rarity: string): { min: number; max: number } {
  switch (rarity) {
    case "Common": return { min: 20, max: 60 };
    case "Uncommon": return { min: 40, max: 80 };
    case "Rare": return { min: 60, max: 120 };
    case "Ultra Rare": return { min: 80, max: 180 };
    case "Legendary": return { min: 120, max: 255 };
    default: return { min: 20, max: 60 };
  }
}

function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  const outputDir = path.join(__dirname, "..", "metadata", "generated");

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log("Generating sample metadata files...\n");

  // Generate metadata for each rarity/pokemon combination
  let tokenId = 1;

  for (const pokemon of SAMPLE_POKEMON) {
    for (const rarity of RARITIES) {
      const statRange = generateRandomStat(rarity);

      const metadata = generateMetadata(
        tokenId,
        pokemon.name,
        pokemon.type,
        rarity,
        randomInRange(statRange.min, statRange.max),
        randomInRange(statRange.min, statRange.max),
        randomInRange(statRange.min, statRange.max),
        randomInRange(statRange.min, statRange.max),
        pokemon.gen,
        `ipfs://YOUR_IPFS_HASH/${pokemon.name.toLowerCase()}_${rarity.toLowerCase().replace(" ", "_")}.png`
      );

      const filename = `${tokenId}.json`;
      const filepath = path.join(outputDir, filename);

      fs.writeFileSync(filepath, JSON.stringify(metadata, null, 2));
      console.log(`Generated: ${filename} - ${metadata.name} (${rarity})`);

      tokenId++;
    }
  }

  console.log(`\n✅ Generated ${tokenId - 1} metadata files in ${outputDir}`);
  console.log("\nNext steps:");
  console.log("1. Create/obtain Pokemon card images");
  console.log("2. Upload images to IPFS (via Pinata or similar)");
  console.log("3. Update image URIs in metadata files");
  console.log("4. Upload metadata files to IPFS");
  console.log("5. Use the base URI when setting up CardPack contract");
}

main().catch(console.error);
