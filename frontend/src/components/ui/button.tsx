import React from "react";

const Button = ({ children, onClick, className = "", disabled = false, variant = "default" }) => {
  const baseStyles = "px-4 py-2 rounded-lg font-semibold transition text-white";
  const variantStyles = {
    default: disabled ? "bg-gray-600 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500",
    destructive: disabled ? "bg-gray-600 cursor-not-allowed" : "bg-red-600 hover:bg-red-500",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

export default Button;
