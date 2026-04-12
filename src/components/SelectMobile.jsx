import { useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

export default function SelectMobile({ value, onValueChange, placeholder, children, triggerClassName }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          <Button
            variant="outline"
            className={`justify-between ${triggerClassName || ''}`}
          >
            {value || placeholder || 'Select...'}
          </Button>
        </DrawerTrigger>
        <DrawerContent>
          <div className="space-y-2 p-4">
            {children &&
              children.props.children.map((item) => (
                <Button
                  key={item.props.value}
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    onValueChange(item.props.value);
                    setOpen(false);
                  }}
                >
                  {item.props.children}
                </Button>
              ))}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      {children}
    </Select>
  );
}