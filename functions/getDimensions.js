import sharp from "sharp";

const getSize = ({ width, height, orientation }) =>
  (orientation || 0) >= 5
    ? { width: height, height: width }
    : { width, height };

const getDimensions = async (filePath) => {
  const size = getSize(await sharp(filePath).metadata());

  return {
    width: size.width,
    height: size.height
  };
};

export default getDimensions;
